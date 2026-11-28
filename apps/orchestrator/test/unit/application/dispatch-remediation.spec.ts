import { describe, it, expect, vi } from 'vitest';
import { TypeScriptPatchSyntaxValidator } from '../../../src/adapters/patch-syntax-validator.js';
import { DispatchRemediation } from '../../../src/application/dispatch-remediation.js';
import { IncidentState } from '../../../src/domain/incident-state.js';
import { Incident } from '../../../src/domain/incident.js';
import type { IncidentRepository } from '../../../src/ports/incident-repository.port.js';
import type { ToolsPort } from '../../../src/ports/tools.port.js';
import type {
  ReasoningPort,
  CollectedEvidence,
  RcaAndPatchSynthesis
} from '../../../src/ports/reasoning.port.js';
import type { EventBroadcasterPort } from '../../../src/ports/event-broadcaster.port.js';
import type { LoggerPort } from '../../../src/ports/logger.port.js';

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

  it('should compute diagnosisSeconds dynamically from incident.startedAt rather than a hardcoded constant', async () => {
    const startedAt = new Date(Date.now() - 12_500).toISOString();
    const incident = new Incident({
      id: 'inc-ttd-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.ENRICHING,
      startedAt
    });
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
        branchName: 'hotfix/zeromttr-inc-ttd-001',
        branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-ttd-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/43',
        commitSha: 'commit789'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 102, success: true }))
    };
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Summary',
        rootCause: 'Root cause',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Explanation'
      }))
    };
    const fallbackAdapter: ReasoningPort = { synthesizeRcaAndPatch: vi.fn() };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);
    const result = await useCase.execute(incident.id, validEvidence, 'blob123');

    expect(result.rcaReport.diagnosisSeconds).toBeGreaterThanOrEqual(12);
    expect(result.rcaReport.diagnosisSeconds).not.toBe(4);
  });

  it('should reject remediation PR creation when evidence.gitDiff.suspectFilePath is empty', async () => {
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
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 101, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Hallucinated patch',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'package.json',
        patchedContent: '{}',
        explanation: 'exp'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fallback',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'exp'
      }))
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const emptySuspectPathEvidence: CollectedEvidence = {
      ...validEvidence,
      gitDiff: {
        ...validEvidence.gitDiff!,
        suspectFilePath: ''
      }
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    await expect(useCase.execute(incident.id, emptySuspectPathEvidence, 'blob123')).rejects.toThrow(
      'Cannot create remediation PR without an authoritative suspectFilePath'
    );

    expect(llmAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(fallbackAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(tools.createRemediationPr).not.toHaveBeenCalled();
  });

  it('should fall back when LLM returns syntactically invalid TypeScript even if required patterns are present', async () => {
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
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/44',
        commitSha: 'commit999'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 103, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Broken syntax',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'export function broken( { const pool = { max: 10 }; client.release(); ;;;',
        explanation: 'invalid ts despite containing required patterns'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback valid TS',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'fallback'
      }))
    };

    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const syntaxValidator = new TypeScriptPatchSyntaxValidator();

    const useCase = new DispatchRemediation(
      repo,
      tools,
      llmAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      {
        syntaxValidator,
        requiredContentPatterns: [/client\.release\(/, /max:\s*10/]
      }
    );

    const result = await useCase.execute(incident.id, validEvidence, 'blob123');
    expect(result.reasoningSource).toBe('fallback');
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({
        patched_content: validPatch,
        reasoning_source: 'fallback'
      })
    );
  });

  it('should fall back when LLM returns syntactically valid TypeScript missing a required content pattern', async () => {
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
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/46',
        commitSha: 'commit-pattern'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 105, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Valid TS missing required pool size',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'export function ok(client: { release: () => void }) { client.release(); }',
        explanation: 'valid ts missing max: 10'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback valid TS with pattern',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'fallback'
      }))
    };

    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const syntaxValidator = new TypeScriptPatchSyntaxValidator();

    const useCase = new DispatchRemediation(
      repo,
      tools,
      llmAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      {
        syntaxValidator,
        requiredContentPatterns: [/client\.release\(/, /max:\s*10/]
      }
    );

    const result = await useCase.execute(incident.id, validEvidence, 'blob123');
    expect(result.reasoningSource).toBe('fallback');
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({
        patched_content: validPatch,
        reasoning_source: 'fallback'
      })
    );
  });

  it('should reset global requiredContentPatterns between calls and abort PR creation if fallback also fails validation', async () => {
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
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/45',
        commitSha: 'commit-regex'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 104, success: true }))
    };

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Valid patch',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'valid'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Comment-only fallback',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: '/* comment without required code */',
        explanation: 'comment'
      }))
    };

    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const globalRegex = /export async function/g;

    const useCase = new DispatchRemediation(
      repo,
      tools,
      llmAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      { requiredContentPatterns: [globalRegex] }
    );

    const first = await useCase.execute(incident.id, validEvidence, 'blob123');
    expect(first.reasoningSource).toBe('llm');

    // Reset state back to ENRICHING and invoke again — global regex must not fail via lastIndex
    const incidentSecond = createMockIncident();
    vi.mocked(repo.findById).mockResolvedValueOnce(incidentSecond);
    const second = await useCase.execute(incidentSecond.id, validEvidence, 'blob123');
    expect(second.reasoningSource).toBe('llm');

    // When both LLM and fallback violate requiredContentPatterns, abort before opening PR
    const prCallsBefore = vi.mocked(tools.createRemediationPr).mock.calls.length;
    const incidentInvalid = createMockIncident();
    vi.mocked(repo.findById).mockResolvedValueOnce(incidentInvalid);
    vi.mocked(llmAdapter.synthesizeRcaAndPatch).mockRejectedValueOnce(new Error('LLM down'));
    await expect(useCase.execute(incidentInvalid.id, validEvidence, 'blob123')).rejects.toThrow(
      'Fallback remediation patch failed defensive validation'
    );
    expect(tools.createRemediationPr).toHaveBeenCalledTimes(prCallsBefore);
  });

  it('should transition to AWAITING_PR only after createRemediationPr succeeds and not on PR failure', async () => {
    const incident = createMockIncident();
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    let resolvePr!: (value: {
      branchName: string;
      branchUrl: string;
      pullRequestUrl: string;
      commitSha: string;
    }) => void;
    const prPromise = new Promise<{
      branchName: string;
      branchUrl: string;
      pullRequestUrl: string;
      commitSha: string;
    }>((resolve) => {
      resolvePr = resolve;
    });

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(() => prPromise),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 105, success: true }))
    };

    const validPatch = ['export async function createPayment() {', '  return true;', '}'].join(
      '\n'
    );

    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Release pooled connection',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'valid'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn()
    };

    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    const execPromise = useCase.execute(incident.id, validEvidence, 'blob123');
    await vi.waitFor(() => {
      expect(tools.createRemediationPr).toHaveBeenCalledOnce();
    });

    // While PR creation is in flight, incident must remain in REMEDIATING (TTPR accuracy)
    expect(incident.state).toBe(IncidentState.REMEDIATING);
    expect(broadcaster.broadcast).not.toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.AWAITING_PR })
    );

    resolvePr({
      branchName: 'hotfix/zeromttr-inc-test-001',
      branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
      pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/46',
      commitSha: 'commit-ordered'
    });

    await execPromise;
    expect(incident.state).toBe(IncidentState.AWAITING_PR);

    // Unhappy path: PR failure must NOT emit AWAITING_PR
    const failedIncident = createMockIncident();
    const failedBroadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    vi.mocked(repo.findById).mockResolvedValue(failedIncident);
    vi.mocked(tools.createRemediationPr).mockRejectedValueOnce(new Error('GitHub 502'));

    const failUseCase = new DispatchRemediation(
      repo,
      tools,
      llmAdapter,
      fallbackAdapter,
      failedBroadcaster
    );

    await expect(failUseCase.execute(failedIncident.id, validEvidence, 'blob123')).rejects.toThrow(
      'GitHub 502'
    );
    expect(failedIncident.state).toBe(IncidentState.REMEDIATING);
    expect(failedBroadcaster.broadcast).not.toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.AWAITING_PR })
    );
  });

  it('should derive exported declarations from suspectFileContent for non-payment repositories and reject incomplete LLM stubs', async () => {
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
        branchName: 'hotfix/zeromttr-inc-order-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-order-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/99',
        commitSha: 'commit999'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 103, success: true }))
    };

    const orderBaseline = `
      export class OrderRepository {
        async saveOrder() { return true; }
      }
      export const orderRepository = new OrderRepository();
      export const pool = 10;
    `;
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Stub missing orderRepository singleton and renaming pool to pool$',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/orders/src/order.repository.ts',
        patchedContent:
          'export class OrderRepository { async saveOrder() { return true; } }\nexport const pool$ = 10;',
        explanation: 'stub'
      }))
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback complete OrderRepository',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/orders/src/order.repository.ts',
        patchedContent: orderBaseline,
        explanation: 'complete'
      }))
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(
      repo,
      tools,
      llmAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      { syntaxValidator: new TypeScriptPatchSyntaxValidator() }
    );

    const orderEvidence: CollectedEvidence = {
      ...validEvidence,
      gitDiff: {
        ...validEvidence.gitDiff,
        suspectFilePath: 'apps/orders/src/order.repository.ts',
        suspectFileContent: orderBaseline
      }
    };

    const result = await useCase.execute(incident.id, orderEvidence, 'blob123');
    expect(result.reasoningSource).toBe('fallback');
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({ patched_content: orderBaseline })
    );
  });

  it('should abort before createRemediationPr when persisted incident becomes terminal during synthesis', async () => {
    const initialIncident = createMockIncident();
    const resetIncident = new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.FAILED
    });
    const repo: IncidentRepository = {
      findById: vi.fn().mockResolvedValueOnce(initialIncident).mockResolvedValueOnce(resetIncident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [resetIncident]),
      save: vi.fn(async () => {})
    };
    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 104, success: true }))
    };
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fix',
        rootCause: 'rc',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'fix'
      }))
    };
    const fallbackAdapter: ReasoningPort = { synthesizeRcaAndPatch: vi.fn() };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    await expect(useCase.execute(initialIncident.id, validEvidence, 'blob123')).rejects.toThrow(
      'terminal state'
    );
    expect(tools.createRemediationPr).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).not.toHaveBeenCalledWith(
      'incident.remediation',
      expect.anything()
    );
  });

  it('should route to deterministic fallback without calling LLM when suspectFileContent is truncated', async () => {
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
        branchName: 'hotfix/zeromttr-inc-trunc-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-trunc-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/101',
        commitSha: 'commit-trunc'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 106, success: true }))
    };
    const llmAdapter: ReasoningPort = { synthesizeRcaAndPatch: vi.fn() };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback for truncated file',
        rootCause: 'Oversized suspect file truncated at cap',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Restored complete baseline'
      }))
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    const truncatedEvidence: CollectedEvidence = {
      ...validEvidence,
      gitDiff: {
        ...validEvidence.gitDiff!,
        suspectFileContent: `${validPatch}\n... [TRUNCATED_DIFF]`
      }
    };

    const result = await useCase.execute(incident.id, truncatedEvidence, 'blob123');
    expect(llmAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);
    expect(result.reasoningSource).toBe('fallback');
  });

  it('should_broadcast_sanitized_incident_llm_failed_sse_when_llm_connection_fails', async () => {
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
        branchName: 'hotfix/zeromttr-inc-llm-fail-001',
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-llm-fail-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/102',
        commitSha: 'commit-llm-fail'
      })),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 107, success: true }))
    };
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => {
        throw new Error(
          'HTTP 503 calling https://api.example.com/v1?key=secret123 with Bearer tok_abc and sk-1234567890abcdef'
        );
      })
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Fallback summary after LLM outage',
        rootCause: 'Pool exhaustion',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: validPatch,
        explanation: 'Restored pool max'
      }))
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    const result = await useCase.execute(incident.id, validEvidence, 'blob123');
    expect(result.reasoningSource).toBe('fallback');
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.llm_failed',
      expect.objectContaining({
        incidentId: incident.id,
        service: 'api-pagamentos-core',
        fallbackUsed: true,
        error:
          'HTTP 503 calling https://api.example.com/v1?key=[REDACTED] with Bearer [REDACTED] and [REDACTED_KEY]'
      })
    );
  });

  it('should_broadcast_incident_llm_failed_with_fallbackUsed_false_when_both_llm_and_fallback_fail', async () => {
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
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => {
        throw new Error('ECONNREFUSED http://ollama:11434/v1');
      })
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => {
        throw new Error('Fallback synthesis error');
      })
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    await expect(useCase.execute(incident.id, validEvidence, 'blob123')).rejects.toThrow(
      'Fallback synthesis error'
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.llm_failed',
      expect.objectContaining({
        incidentId: incident.id,
        service: 'api-pagamentos-core',
        fallbackUsed: false,
        error: 'ECONNREFUSED http://ollama:11434/v1'
      })
    );
  });

  it.each([
    {
      rawError: 'HTTP 401 access_token=opaqueCredential_abc123 rejected',
      expected: 'HTTP 401 access_token=[REDACTED] rejected',
      secret: 'opaqueCredential_abc123'
    },
    {
      rawError: 'HTTP 401 {"access_token":"opaqueCredential_abc123","scope":"llm"}',
      expected: 'HTTP 401 {"access_token":"[REDACTED]","scope":"llm"}',
      secret: 'opaqueCredential_abc123'
    },
    {
      rawError: 'ECONNREFUSED https://svc-user:s3cretPassw0rd@llm.internal/v1',
      expected: 'ECONNREFUSED https://[REDACTED]@llm.internal/v1',
      secret: 's3cretPassw0rd'
    }
  ])(
    'should_redact_credentials_in_sse_payload_and_structured_log ($expected)',
    async ({ rawError, expected, secret }) => {
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
          branchName: 'hotfix/zeromttr-inc-llm-token-001',
          branchUrl:
            'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-llm-token-001',
          pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/103',
          commitSha: 'commit-llm-token'
        })),
        sendPostMortemResend: vi.fn(),
        annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 108, success: true }))
      };
      const llmAdapter: ReasoningPort = {
        synthesizeRcaAndPatch: vi.fn(async () => {
          throw new Error(rawError);
        })
      };
      const fallbackAdapter: ReasoningPort = {
        synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
          summary: 'Fallback summary after LLM auth failure',
          rootCause: 'Pool exhaustion',
          evidenceRefs: ['trace1'],
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          patchedContent: validPatch,
          explanation: 'Restored pool max'
        }))
      };
      const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
      const logger: LoggerPort = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const useCase = new DispatchRemediation(
        repo,
        tools,
        llmAdapter,
        fallbackAdapter,
        broadcaster,
        logger
      );

      await useCase.execute(incident.id, validEvidence, 'blob123');

      expect(broadcaster.broadcast).toHaveBeenCalledWith(
        'incident.llm_failed',
        expect.objectContaining({
          fallbackUsed: true,
          error: expected
        })
      );
      const serializedLogs = JSON.stringify(vi.mocked(logger.warn).mock.calls);
      expect(serializedLogs).toContain('[REDACTED]');
      expect(serializedLogs).not.toContain(secret);
    }
  );

  it('should_not_report_fallback_exceptions_as_llm_failures_when_llm_patch_is_rejected', async () => {
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
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };
    const llmAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async (): Promise<RcaAndPatchSynthesis> => ({
        summary: 'Invalid LLM patch',
        rootCause: 'Pool exhaustion',
        evidenceRefs: ['trace1'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: '',
        explanation: 'Empty patch'
      }))
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => {
        throw new Error('Fallback synthesis error');
      })
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const useCase = new DispatchRemediation(repo, tools, llmAdapter, fallbackAdapter, broadcaster);

    await expect(useCase.execute(incident.id, validEvidence, 'blob123')).rejects.toThrow(
      'Fallback synthesis error'
    );
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).not.toHaveBeenCalledWith(
      'incident.llm_failed',
      expect.anything()
    );
  });
});
