import { describe, it, expect, vi } from 'vitest';
import { EnrichWithDeployDiff } from '../../../src/application/enrich-with-deploy-diff.js';
import { IncidentState } from '../../../src/domain/incident-state.js';
import { Incident } from '../../../src/domain/incident.js';
import type { IncidentRepository } from '../../../src/ports/incident-repository.port.js';
import type { ToolsPort } from '../../../src/ports/tools.port.js';
import type { EventBroadcasterPort } from '../../../src/ports/event-broadcaster.port.js';

describe('EnrichWithDeployDiff Use Case', () => {
  it('should transition to ENRICHING, call inspectGitDeployDiff, emit finops and docs events', async () => {
    const incident = new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.INVESTIGATING
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
      inspectGitDeployDiff: vi.fn(async () => ({
        suspectCommitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
        authorLogin: 'deploy-bot',
        commitMessage: 'feat: reduce pool size',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        currentBlobSha: 'blob123456',
        truncatedPatch: '@@ -10,2 +10,2 @@\n- pool.max = 10\n+ pool.max = 2',
        finops: {
          rawBytesFetched: 45000,
          compactedBytesSentToLlm: 1200,
          payloadReductionPercent: 97,
          estimatedTokensSaved: 10000
        }
      })),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const useCase = new EnrichWithDeployDiff(repo, tools, broadcaster);
    const result = await useCase.execute(incident.id, 'v2.14.7', 'v2.14.8');

    expect(incident.state).toBe(IncidentState.ENRICHING);
    expect(tools.inspectGitDeployDiff).toHaveBeenCalledWith({
      base_ref: 'v2.14.7',
      head_ref: 'v2.14.8',
      service_path: 'apps/target-app-demo'
    });
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.ENRICHING })
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith('incident.finops', expect.any(Object));
    expect(broadcaster.broadcast).toHaveBeenCalledWith('incident.docs', expect.any(Object));
    expect(result.suspectCommitSha).toBe('8f14e45fceea167a5a36dedd4bea2543d1a2b3c4');
  });

  it('should derive docs URL from TARGET_GITHUB_REPO when TARGET_REPO_URL is unset', async () => {
    const prevRepoUrl = process.env.TARGET_REPO_URL;
    const prevGithubRepo = process.env.TARGET_GITHUB_REPO;

    try {
      process.env.TARGET_REPO_URL = '';
      process.env.TARGET_GITHUB_REPO = 'example/payments';

      const incident = new Incident({
        id: 'inc-test-002',
        service: 'api-pagamentos-core',
        severity: 'critical',
        fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
        state: IncidentState.INVESTIGATING
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
        inspectGitDeployDiff: vi.fn(async () => ({
          suspectCommitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
          authorLogin: 'deploy-bot',
          commitMessage: 'feat: reduce pool size',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          currentBlobSha: 'blob123456',
          truncatedPatch: '@@ -10,2 +10,2 @@\n- pool.max = 10\n+ pool.max = 2',
          finops: {
            rawBytesFetched: 45000,
            compactedBytesSentToLlm: 1200,
            payloadReductionPercent: 97,
            estimatedTokensSaved: 10000
          }
        })),
        createRemediationPr: vi.fn(),
        sendPostMortemResend: vi.fn(),
        annotateGrafanaIncident: vi.fn()
      };

      const broadcaster: EventBroadcasterPort = {
        broadcast: vi.fn()
      };

      const useCase = new EnrichWithDeployDiff(repo, tools, broadcaster);
      await useCase.execute(incident.id, 'v2.14.7', 'v2.14.8');

      expect(incident.docs?.[0]?.url).toBe('https://github.com/example/payments');
    } finally {
      if (prevRepoUrl === undefined) {
        delete process.env.TARGET_REPO_URL;
      } else {
        process.env.TARGET_REPO_URL = prevRepoUrl;
      }
      if (prevGithubRepo === undefined) {
        delete process.env.TARGET_GITHUB_REPO;
      } else {
        process.env.TARGET_GITHUB_REPO = prevGithubRepo;
      }
    }
  });
});
