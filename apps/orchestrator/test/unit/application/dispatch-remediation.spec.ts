import { describe, it, expect, vi } from 'vitest';
import { DispatchRemediation } from '../../../src/application/index.js';
import { IncidentState, Incident } from '../../../src/domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  ReasoningPort,
  EventBroadcasterPort,
  CollectedEvidence,
  RcaAndPatchSynthesis
} from '../../../src/ports/index.js';

describe('DispatchRemediation Use Case', () => {
  const createMockIncident = () =>
    new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.ENRICHING
    });

  const validEvidence: CollectedEvidence = {
    incidentId: 'inc-test-001',
    service: 'api-pagamentos-core',
    alertName: 'PaymentServicePoolExhaustion',
    promqlSummary: {
      metric: 'http_server_duration_milliseconds_bucket',
      p95LatencyMs: 4600,
      dbPoolWaiting: 15
    },
    traceAnalysis: {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      criticalOperation: 'pg.pool.acquire',
      durationMs: 4600,
      servicesInvolved: ['api-pagamentos-core', 'postgres']
    },
    logSample: 'ERROR [api-pagamentos-core] Pool exhausted [REDACTED_CPF]',
    gitDiff: {
      baseRef: 'v2.14.7',
      headRef: 'v2.14.8',
      suspectCommit: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
      authorLogin: 'deploy-bot',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patch: 'pool size change'
    }
  };

  const validPatch = `
    import { Pool } from 'pg';
    const pool = new Pool({ max: 10 });
    export async function query() {
      const client = await pool.connect();
      try { return await client.query('SELECT 1'); }
      finally { client.release(); }
    }
  `;

  it('should use LLM reasoning when PII guard passes and patch validation succeeds', async () => {
    const incident = createMockIncident();
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(async () => ({
        branchName: 'hotfix/zeromttr-inc-test-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
        commitSha: 'commit123456'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 101, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'LLM generated summary',
        rootCause: 'Connection leak',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Restored finally block'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn()
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    const result = await useCase.execute(incident.id, validEvidence, 'blob123');

    expect(llmAdapter.synthesizeRcaAndPatch).toHaveBeenCalled();
    expect(fallbackAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(result.reasoningSource).toBe('llm');
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_source: 'llm' })
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.rca',
      expect.objectContaining({ reasoningSource: 'llm' })
    );
  });

  it('should fail-closed to deterministic fallback adapter when PII guard detects leaked patterns', async () => {
    const incident = createMockIncident();
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(async () => ({
        branchName: 'hotfix/zeromttr-inc-test-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
        commitSha: 'commit123456'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 101, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn()
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback generated summary',
        rootCause: 'Fallback root cause',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Fallback patch'
      }))
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const leakedEvidence: CollectedEvidence = {
      ...validEvidence,
      logSample: 'ERROR with leaked CPF 123.456.789-00 in log'
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    const result = await useCase.execute(incident.id, leakedEvidence, 'blob123');

    expect(llmAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalled();
    expect(result.reasoningSource).toBe('fallback');
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_source: 'fallback' })
    );
  });

  it('should fail-closed to fallback adapter when CPF appears in traceAnalysis.criticalOperation', async () => {
    const incident = createMockIncident();
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(async () => ({
        branchName: 'hotfix/zeromttr-inc-test-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
        commitSha: 'commit123456'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 101, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn()
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback generated summary',
        rootCause: 'Fallback root cause',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Fallback patch'
      }))
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const piiInTraceEvidence: CollectedEvidence = {
      ...validEvidence,
      traceAnalysis: {
        ...validEvidence.traceAnalysis!,
        criticalOperation: 'processPayment:cpf:529.982.247-25'
      }
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);
    const result = await useCase.execute(incident.id, piiInTraceEvidence, 'blob123');

    expect(llmAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalled();
    expect(result.reasoningSource).toBe('fallback');

    const rcaBroadcastCall = vi
      .mocked(broadcaster.broadcast)
      .mock.calls.find((call) => call[0] === 'incident.rca');
    expect(rcaBroadcastCall).toBeDefined();
    expect(JSON.stringify(rcaBroadcastCall?.[1])).not.toContain('529.982.247-25');
    expect(result.rcaReport.criticalSpan).not.toContain('529.982.247-25');
  });
});
