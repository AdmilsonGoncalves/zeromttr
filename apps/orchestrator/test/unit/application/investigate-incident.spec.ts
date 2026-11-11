import { describe, it, expect, vi } from 'vitest';
import { InvestigateIncident } from '../../../src/application/index.js';
import { IncidentState, Incident } from '../../../src/domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  TargetStatusPort,
  EventBroadcasterPort
} from '../../../src/ports/index.js';

describe('InvestigateIncident Use Case', () => {
  const createMockIncident = () =>
    new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.RECEIVED
    });

  it('should transition to INVESTIGATING, query PromQL, trace and Loki, and collect signals', async () => {
    const incident = createMockIncident();
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(async () => ({
        seriesCount: 1,
        summarizedSeries: [
          {
            metric: { service_name: 'api-pagamentos-core' },
            p95: 4500,
            max: 5000,
            sampleCount: 10
          }
        ],
        exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        finops: {
          rawBytesFetched: 1000,
          compactedBytesSentToLlm: 100,
          payloadReductionPercent: 90,
          estimatedTokensSaved: 200
        }
      })),
      queryLokiLogs: vi.fn(async () => ({
        linesReturned: 1,
        logs: [
          {
            timestamp: new Date().toISOString(),
            line: 'ERROR [api-pagamentos-core] Pool exhausted [REDACTED_CPF]'
          }
        ],
        finops: {
          rawBytesFetched: 500,
          compactedBytesSentToLlm: 50,
          payloadReductionPercent: 90,
          estimatedTokensSaved: 100
        }
      })),
      analyzeOtelTrace: vi.fn(async () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        rootServiceName: 'api-pagamentos-core',
        totalDurationMs: 4600,
        criticalSpans: [
          {
            spanId: 'span-001',
            serviceName: 'api-pagamentos-core',
            operationName: 'pg.pool.acquire',
            durationMs: 4600,
            hasError: true,
            errorMessage: 'Timeout acquire connection'
          }
        ],
        servicesInvolved: ['api-pagamentos-core', 'postgres']
      })),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };

    const targetStatus: TargetStatusPort = {
      getStatus: vi.fn(async () => ({
        status: 'degraded' as const,
        service: 'api-pagamentos-core',
        version: 'v2.14.8',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        rawEdgeLogPreCollector: 'raw sample'
      })),
      triggerChaos: vi.fn(),
      reset: vi.fn()
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const useCase = new InvestigateIncident(repo, tools, targetStatus, broadcaster);
    const result = await useCase.execute(incident.id);

    expect(incident.state).toBe(IncidentState.INVESTIGATING);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.INVESTIGATING })
    );
    expect(result.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(result.criticalSpan).toBe('pg.pool.acquire');
    expect(result.servicesInvolved).toEqual(['api-pagamentos-core', 'postgres']);
  });
});
