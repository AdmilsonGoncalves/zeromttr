import { describe, it, expect, vi } from 'vitest';
import {
  DispatchRemediation,
  EnrichWithDeployDiff,
  InvestigateIncident,
  NotifyOnCall,
  OrchestratorWorkflow
} from '../../../src/application/index.js';
import { IncidentState, Incident, type RcaReport } from '../../../src/domain/index.js';
import {
  createMockBroadcaster,
  createMockClock,
  createMockFinOpsData,
  createMockIncidentRepository,
  createMockReasoningPort,
  createMockTargetStatusPort,
  createMockToolsPort
} from '../../helpers/test-doubles.helper.js';

describe('OrchestratorWorkflow Use Case', () => {
  it('should execute full autonomous pipeline from investigation to notification', async () => {
    const incident = new Incident({
      id: 'inc-workflow-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.RECEIVED
    });

    const repo = createMockIncidentRepository([incident]);
    const tools = createMockToolsPort();
    const targetStatus = createMockTargetStatusPort();
    const broadcaster = createMockBroadcaster();
    const llm = createMockReasoningPort();
    const clock = createMockClock();

    const investigateIncident = new InvestigateIncident(repo, tools, targetStatus, broadcaster);
    const enrichWithDeployDiff = new EnrichWithDeployDiff(repo, tools, broadcaster);
    const dispatchRemediation = new DispatchRemediation(repo, tools, llm, llm, broadcaster);
    const notifyOnCall = new NotifyOnCall(
      repo,
      tools,
      clock,
      broadcaster,
      'test-hmac-secret',
      'https://zeromttr.agjworks.com'
    );

    vi.spyOn(investigateIncident, 'execute').mockResolvedValue({
      incidentId: incident.id,
      promqlOutput: {
        seriesCount: 1,
        summarizedSeries: [{ metric: {}, p95: 4500, max: 5000, sampleCount: 10 }],
        exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        finops: createMockFinOpsData()
      },
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      criticalSpan: 'pg.pool.acquire',
      spans: [],
      servicesInvolved: ['api-pagamentos-core'],
      lokiOutput: {
        linesReturned: 1,
        logs: [],
        finops: createMockFinOpsData()
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
    });

    vi.spyOn(enrichWithDeployDiff, 'execute').mockResolvedValue({
      suspectCommitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
      authorLogin: 'deploy-bot',
      commitMessage: 'commit message',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      currentBlobSha: 'blob123',
      truncatedPatch: 'patch diff',
      finops: createMockFinOpsData()
    });

    const mockRcaReport: RcaReport = {
      summary: 'Summary',
      rootCause: 'Root cause',
      reasoningSource: 'llm',
      evidenceCoveragePercent: 100,
      signalsCollected: 4,
      signalsTotal: 4,
      blastRadius: ['api-pagamentos-core'],
      diagnosisSeconds: 4,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      criticalSpan: 'pg.pool.acquire',
      spans: [],
      logSample: 'log sample',
      piiGuardAudit: {
        leakedPatternsDetected: 0,
        detectedTypes: [],
        edgeRedactedTokensVerified: 0,
        passed: true
      },
      mitigations: ['Fix pool']
    };

    vi.spyOn(dispatchRemediation, 'execute').mockResolvedValue({
      rcaReport: mockRcaReport,
      prResult: {
        branchName: 'hotfix/zeromttr-001',
        branchUrl: 'https://github.com/example/repo/tree/hotfix/zeromttr-001',
        pullRequestUrl: 'https://github.com/example/repo/pull/1',
        commitSha: 'sha-1'
      },
      reasoningSource: 'llm'
    });

    vi.spyOn(notifyOnCall, 'execute').mockResolvedValue({
      emailId: 'email-123',
      approveUrl: 'https://app/decision/1#action=approve',
      rejectUrl: 'https://app/decision/1#action=reject'
    });

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

    const repo = createMockIncidentRepository([incident]);
    const tools = createMockToolsPort();
    const targetStatus = createMockTargetStatusPort();
    const broadcaster = createMockBroadcaster();
    const llm = createMockReasoningPort();
    const clock = createMockClock();

    const investigateIncident = new InvestigateIncident(repo, tools, targetStatus, broadcaster);
    vi.spyOn(investigateIncident, 'execute').mockRejectedValue(
      new Error('Connection refused by telemetry backend')
    );

    const workflow = new OrchestratorWorkflow(
      repo,
      investigateIncident,
      new EnrichWithDeployDiff(repo, tools, broadcaster),
      new DispatchRemediation(repo, tools, llm, llm, broadcaster),
      new NotifyOnCall(repo, tools, clock, broadcaster, 'secret', 'https://dash'),
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
    const repo = createMockIncidentRepository();
    const tools = createMockToolsPort();
    const targetStatus = createMockTargetStatusPort();
    const broadcaster = createMockBroadcaster();
    const llm = createMockReasoningPort();
    const clock = createMockClock();

    const workflow = new OrchestratorWorkflow(
      repo,
      new InvestigateIncident(repo, tools, targetStatus, broadcaster),
      new EnrichWithDeployDiff(repo, tools, broadcaster),
      new DispatchRemediation(repo, tools, llm, llm, broadcaster),
      new NotifyOnCall(repo, tools, clock, broadcaster, 'secret', 'https://dash'),
      broadcaster
    );

    await workflow.runFullPipeline('non-existent-id');
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });
});
