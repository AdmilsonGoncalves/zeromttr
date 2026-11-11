import { describe, it, expect, vi } from 'vitest';
import {
  OrchestratorWorkflow,
  type InvestigateIncident,
  type EnrichWithDeployDiff,
  type DispatchRemediation,
  type NotifyOnCall
} from '../../../src/application/index.js';
import { IncidentState, Incident } from '../../../src/domain/index.js';
import type { IncidentRepository, EventBroadcasterPort } from '../../../src/ports/index.js';

describe('OrchestratorWorkflow Use Case', () => {
  it('should execute full autonomous pipeline from investigation to notification', async () => {
    const incident = new Incident({
      id: 'inc-workflow-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.RECEIVED
    });

    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const investigateIncident: InvestigateIncident = {
      execute: vi.fn(async () => ({
        incidentId: incident.id,
        promqlOutput: {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, p95: 4500, max: 5000, sampleCount: 10 }],
          exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          finops: {
            rawBytesFetched: 100,
            compactedBytesSentToLlm: 10,
            payloadReductionPercent: 90,
            estimatedTokensSaved: 10
          }
        },
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        criticalSpan: 'pg.pool.acquire',
        spans: [],
        servicesInvolved: ['api-pagamentos-core'],
        lokiOutput: {
          linesReturned: 1,
          logs: [],
          finops: {
            rawBytesFetched: 100,
            compactedBytesSentToLlm: 10,
            payloadReductionPercent: 90,
            estimatedTokensSaved: 10
          }
        },
        logSample: 'log sample',
        targetStatus: {
          status: 'degraded',
          service: 'api-pagamentos-core',
          version: 'v2.14.8',
          previousHealthyVersion: 'v2.14.7',
          targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          rawEdgeLogPreCollector: 'raw'
        },
        hasPromqlAnomaly: true,
        hasMetricExemplar: true,
        hasTempoErrorSpan: true
      }))
    } as unknown as InvestigateIncident;

    const enrichWithDeployDiff: EnrichWithDeployDiff = {
      execute: vi.fn(async () => ({
        suspectCommitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
        authorLogin: 'deploy-bot',
        commitMessage: 'commit message',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        currentBlobSha: 'blob123',
        truncatedPatch: 'patch diff',
        finops: {
          rawBytesFetched: 100,
          compactedBytesSentToLlm: 10,
          payloadReductionPercent: 90,
          estimatedTokensSaved: 10
        }
      }))
    } as unknown as EnrichWithDeployDiff;

    const dispatchRemediation: DispatchRemediation = {
      execute: vi.fn(async () => ({
        rcaReport: {} as any,
        prResult: {} as any,
        reasoningSource: 'llm'
      }))
    } as unknown as DispatchRemediation;

    const notifyOnCall: NotifyOnCall = {
      execute: vi.fn(async () => ({
        emailId: 'email-123',
        approveUrl: 'https://app/decision/1#action=approve',
        rejectUrl: 'https://app/decision/1#action=reject'
      }))
    } as unknown as NotifyOnCall;

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const workflow = new OrchestratorWorkflow(
      repo,
      investigateIncident,
      enrichWithDeployDiff,
      dispatchRemediation,
      notifyOnCall,
      broadcaster
    );

    await workflow.runFullPipeline(incident.id);

    expect(investigateIncident.execute).toHaveBeenCalledWith(incident.id);
    expect(enrichWithDeployDiff.execute).toHaveBeenCalledWith(incident.id, 'v2.14.7', 'v2.14.8');
    expect(dispatchRemediation.execute).toHaveBeenCalled();
    expect(notifyOnCall.execute).toHaveBeenCalledWith(incident.id);
  });

  it('should mark incident as FAILED and broadcast transition if an unexpected exception occurs during pipeline', async () => {
    const incident = new Incident({
      id: 'inc-workflow-err',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.RECEIVED
    });

    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const investigateIncident: InvestigateIncident = {
      execute: vi.fn(async () => {
        throw new Error('Connection refused by telemetry backend');
      })
    } as unknown as InvestigateIncident;

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const workflow = new OrchestratorWorkflow(
      repo,
      investigateIncident,
      {} as any,
      {} as any,
      {} as any,
      broadcaster
    );

    await workflow.runFullPipeline(incident.id);

    expect(incident.state).toBe(IncidentState.FAILED);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.FAILED })
    );
  });

  it('should safely do nothing if incident is not found in repository', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    const workflow = new OrchestratorWorkflow(
      repo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      broadcaster
    );

    await workflow.runFullPipeline('non-existent-id');
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });
});
