import { describe, it, expect, vi } from 'vitest';
import {
  DispatchRemediation,
  EnrichWithDeployDiff,
  InvestigateIncident,
  NotifyOnCall,
  RecordDecision,
  OrchestratorWorkflow,
  HandleAlert,
  IncidentNotFoundError,
  IncidentAlreadyResolvedError
} from '../../../src/application/index.js';
import {
  canTransition,
  IncidentState,
  Incident,
  computeAlertFingerprint,
  DecisionHmac
} from '../../../src/domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  ReasoningPort,
  TargetStatusPort,
  Clock,
  CollectedEvidence
} from '../../../src/ports/index.js';

describe('Branch Coverage Enhancements', () => {
  it('should cover computeAlertFingerprint fallback defaults when labels are empty', () => {
    expect(computeAlertFingerprint({})).toBe('unknown-alert:unknown-service');
  });

  it('should cover canTransition with unknown state', () => {
    expect(canTransition('UNKNOWN' as any, IncidentState.INVESTIGATING)).toBe(false);
  });

  it('should cover non-existent incident throws in EnrichWithDeployDiff', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };
    const useCase = new EnrichWithDeployDiff(repo, {} as any, { broadcast: vi.fn() });
    await expect(useCase.execute('none')).rejects.toThrow();
  });

  it('should cover non-existent incident throws in InvestigateIncident', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };
    const useCase = new InvestigateIncident(repo, {} as any, {} as any, { broadcast: vi.fn() });
    await expect(useCase.execute('none')).rejects.toThrow();
  });

  it('should cover trace analysis with no error span in InvestigateIncident', async () => {
    const incident = new Incident({
      id: 'inc-no-err-span',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.INVESTIGATING
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools: ToolsPort = {
      executePromqlRange: vi.fn(async () => ({
        seriesCount: 1,
        summarizedSeries: [{ metric: {}, p95: 1000 }],
        exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        finops: {} as any
      })),
      queryLokiLogs: vi.fn(async () => ({ linesReturned: 0, logs: [], finops: {} as any })),
      analyzeOtelTrace: vi.fn(async () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        criticalSpans: [
          {
            spanId: 's1',
            serviceName: 'api',
            operationName: 'fast.op',
            durationMs: 10,
            hasError: false
          }
        ],
        servicesInvolved: ['api']
      })),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };
    const targetStatus: TargetStatusPort = {
      getStatus: vi.fn(async () => ({
        status: 'healthy' as const,
        service: 'api',
        version: 'v2.14.7',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'repo',
        suspectFilePath: 'path',
        rawEdgeLogPreCollector: 'raw'
      })),
      triggerChaos: vi.fn(),
      reset: vi.fn()
    };
    const useCase = new InvestigateIncident(repo, tools, targetStatus, { broadcast: vi.fn() });
    const res = await useCase.execute(incident.id);
    expect(res.criticalSpan).toBe('fast.op');
    expect(res.hasTempoErrorSpan).toBe(false);
  });

  it('should cover trace analysis catch when analyzeOtelTrace throws', async () => {
    const incident = new Incident({
      id: 'inc-trace-err',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.INVESTIGATING
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools: ToolsPort = {
      executePromqlRange: vi.fn(async () => ({
        seriesCount: 1,
        summarizedSeries: [{ metric: {} }],
        exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        finops: {} as any
      })),
      queryLokiLogs: vi.fn(async () => ({ linesReturned: 0, logs: [], finops: {} as any })),
      analyzeOtelTrace: vi.fn(async () => {
        throw new Error('Tempo unavailable');
      }),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };
    const targetStatus: TargetStatusPort = {
      getStatus: vi.fn(async () => ({
        status: 'healthy' as const,
        service: 'api',
        version: 'v2.14.7',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'repo',
        suspectFilePath: 'path',
        rawEdgeLogPreCollector: 'raw'
      })),
      triggerChaos: vi.fn(),
      reset: vi.fn()
    };
    const useCase = new InvestigateIncident(repo, tools, targetStatus, { broadcast: vi.fn() });
    const res = await useCase.execute(incident.id);
    expect(res.hasTempoErrorSpan).toBe(false);
  });

  it('should cover defensive patch validation failures routing to fallback in DispatchRemediation', async () => {
    const incident = new Incident({
      id: 'inc-defensive-test',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.ENRICHING
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
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
      createRemediationPr: vi.fn(async () => ({}) as any),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => {
        throw new Error('Grafana down');
      })
    };

    // LLM returns invalid file path
    const llmAdapterWrongPath: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Wrong path',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'wrong/path.ts',
        patchedContent: 'client.release(); max: 10',
        explanation: 'exp'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fallback',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'client.release(); max: 10',
        explanation: 'exp'
      }))
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapterWrongPath, fallbackAdapter, {
      broadcast: vi.fn()
    });

    const evidence: CollectedEvidence = {
      incidentId: incident.id,
      service: incident.service,
      alertName: 'Alert',
      promqlSummary: { metric: 'm' },
      traceAnalysis: {
        traceId: 't1',
        criticalOperation: 'op',
        durationMs: 10,
        servicesInvolved: ['s1']
      },
      logSample: 'log sample',
      gitDiff: {
        baseRef: 'v1',
        headRef: 'v2',
        suspectCommit: 'c1',
        authorLogin: 'a1',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patch: 'p1'
      }
    };

    const res = await useCase.execute(incident.id, evidence);
    expect(res.reasoningSource).toBe('fallback');
    expect(incident.state).toBe(IncidentState.AWAITING_PR);
    expect(fallbackAdapter.synthesizeRcaAndPatch).toHaveBeenCalled();

    // Test non-existent incident
    await expect(useCase.execute('non-existent', evidence)).rejects.toThrow();
  });

  it('should cover defensive patch validation failures when missing client.release or max 10', async () => {
    const incident = new Incident({
      id: 'inc-defensive-patch',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.ENRICHING
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
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
      createRemediationPr: vi.fn(async () => ({}) as any),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 1, success: true }))
    };

    // LLM returns invalid patch (wrong suspect file path)
    const llmAdapterNoRelease: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'No release',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'wrong/path/file.ts',
        patchedContent: 'const pool = 10;',
        explanation: 'exp'
      }))
    };

    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fallback',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'client.release(); max: 10',
        explanation: 'exp'
      }))
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapterNoRelease, fallbackAdapter, {
      broadcast: vi.fn()
    });

    const evidence: CollectedEvidence = {
      incidentId: incident.id,
      service: incident.service,
      alertName: 'Alert',
      promqlSummary: { metric: 'm' },
      traceAnalysis: {
        traceId: 't1',
        criticalOperation: 'op',
        durationMs: 10,
        servicesInvolved: ['s1']
      },
      logSample: 'log sample',
      gitDiff: {
        baseRef: 'v1',
        headRef: 'v2',
        suspectCommit: 'c1',
        authorLogin: 'a1',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patch: 'p1'
      }
    };

    const res = await useCase.execute(incident.id, evidence);
    expect(res.reasoningSource).toBe('fallback');
    expect(incident.state).toBe(IncidentState.AWAITING_PR);
  });

  it('should cover NotifyOnCall when incident not found or resend throws', async () => {
    const incident = new Incident({
      id: 'inc-notify-err',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.AWAITING_PR
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'none' ? null : incident)),
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
      sendPostMortemResend: vi.fn(async () => {
        throw new Error('Resend rate limited');
      }),
      annotateGrafanaIncident: vi.fn()
    };
    const clock: Clock = { now: () => 1730000000000, iso: () => '2026-11-10T12:00:00Z' };

    const useCase = new NotifyOnCall(
      repo,
      tools,
      clock,
      { broadcast: vi.fn() },
      'secret',
      'https://dash'
    );

    await expect(useCase.execute('none')).rejects.toThrow();

    const res = await useCase.execute(incident.id);
    expect(res.emailId).toContain('email-fallback');
  });

  it('should cover DispatchRemediation when LLM adapter throws an error', async () => {
    const incident = new Incident({
      id: 'inc-llm-throws',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.ENRICHING
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
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
      createRemediationPr: vi.fn(async () => ({}) as any),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 1, success: true }))
    };
    const llmAdapterThrows: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => {
        throw new Error('Gemini API Quota Exceeded');
      })
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fallback',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'client.release(); max: 10',
        explanation: 'exp'
      }))
    };

    const useCase = new DispatchRemediation(repo, tools, llmAdapterThrows, fallbackAdapter, {
      broadcast: vi.fn()
    });

    const evidence: CollectedEvidence = {
      incidentId: incident.id,
      service: incident.service,
      alertName: 'Alert',
      promqlSummary: { metric: 'm' },
      traceAnalysis: {
        traceId: 't1',
        criticalOperation: 'op',
        durationMs: 10,
        servicesInvolved: ['s1']
      },
      logSample: 'log sample',
      gitDiff: {
        baseRef: 'v1',
        headRef: 'v2',
        suspectCommit: 'c1',
        authorLogin: 'a1',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patch: 'p1'
      }
    };

    const res = await useCase.execute(incident.id, evidence);
    expect(res.reasoningSource).toBe('fallback');
    expect(incident.state).toBe(IncidentState.AWAITING_PR);
  });

  it('should cover DispatchRemediation when incident is already AWAITING_PR', async () => {
    const incident = new Incident({
      id: 'inc-already-awaiting',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.AWAITING_PR
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
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
      createRemediationPr: vi.fn(async () => ({}) as any),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 1, success: true }))
    };
    const fallbackAdapter: ReasoningPort = {
      synthesizeRcaAndPatch: vi.fn(async () => ({
        summary: 'Fallback',
        rootCause: 'rc',
        evidenceRefs: [],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'client.release(); max: 10',
        explanation: 'exp'
      }))
    };

    const useCase = new DispatchRemediation(repo, tools, fallbackAdapter, fallbackAdapter, {
      broadcast: vi.fn()
    });

    const evidence: CollectedEvidence = {
      incidentId: incident.id,
      service: incident.service,
      alertName: 'Alert',
      promqlSummary: { metric: 'm' },
      traceAnalysis: {
        traceId: 't1',
        criticalOperation: 'op',
        durationMs: 10,
        servicesInvolved: ['s1']
      },
      logSample: 'log sample',
      gitDiff: {
        baseRef: 'v1',
        headRef: 'v2',
        suspectCommit: 'c1',
        authorLogin: 'a1',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patch: 'p1'
      }
    };

    const res = await useCase.execute(incident.id, evidence);
    expect(res.reasoningSource).toBe('llm');
    expect(incident.state).toBe(IncidentState.AWAITING_PR);
  });

  it('should cover RecordDecision executeSimulated unhappy paths and grafana annotation errors', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => {
        if (id === 'non-existent') {
          return null;
        }
        if (id === 'inc-wrong-state') {
          return new Incident({
            id: 'inc-wrong-state',
            service: 'svc',
            severity: 'critical',
            fingerprint: 'fp',
            state: IncidentState.RESOLVED
          });
        }
        return new Incident({
          id,
          service: 'svc',
          severity: 'critical',
          fingerprint: 'fp',
          state: IncidentState.NOTIFIED
        });
      }),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
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
      annotateGrafanaIncident: vi.fn(async () => {
        throw new Error('Grafana down');
      })
    };
    const clock: Clock = { now: () => 1730000000000, iso: () => '2026-11-10T12:00:00Z' };
    const broadcaster = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, 'test-secret');

    // Simulated: not found
    await expect(useCase.executeSimulated('non-existent', 'approve')).rejects.toThrow(
      IncidentNotFoundError
    );

    // Simulated: wrong state
    await expect(useCase.executeSimulated('inc-wrong-state', 'approve')).rejects.toThrow(
      IncidentAlreadyResolvedError
    );

    // Simulated: grafana annotation throws
    const resSim = await useCase.executeSimulated('inc-notified', 'reject');
    expect(resSim.state).toBe(IncidentState.REJECTED);

    // Signed execute: grafana annotation throws
    const exp = Math.floor(clock.now() / 1000) + 900;
    const sig = DecisionHmac.sign('inc-notified-2', 'approve', exp, 'test-secret');
    const resSigned = await useCase.execute('inc-notified-2', 'approve', sig, exp);
    expect(resSigned.state).toBe(IncidentState.RESOLVED);
  });

  it('should cover OrchestratorWorkflow edge cases: non-existent incident and error when already resolved', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => {
        if (id === 'non-existent') {
          return null;
        }
        return new Incident({
          id,
          service: 'svc',
          severity: 'critical',
          fingerprint: 'fp',
          state: IncidentState.RESOLVED
        });
      }),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };

    const investigateIncident = {
      execute: vi.fn(async () => {
        throw new Error('Pipeline error');
      })
    } as any;

    const workflow = new OrchestratorWorkflow(
      repo,
      investigateIncident,
      {} as any,
      {} as any,
      {} as any,
      { broadcast: vi.fn() }
    );

    // Case 1: non-existent incident returns early
    await expect(workflow.runFullPipeline('non-existent')).resolves.toBeUndefined();

    // Case 2: pipeline fails on already resolved incident (does not transition to FAILED)
    await expect(workflow.runFullPipeline('inc-resolved')).resolves.toBeUndefined();
  });

  it('should cover OrchestratorWorkflow when transition to FAILED throws', async () => {
    const incident = new Incident({
      id: 'inc-throwing-transition',
      service: 'svc',
      severity: 'critical',
      fingerprint: 'fp',
      state: IncidentState.INVESTIGATING
    });
    vi.spyOn(incident, 'transition').mockImplementation(() => {
      throw new Error('Transition error');
    });

    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };

    const investigateIncident = {
      execute: vi.fn(async () => {
        throw new Error('Pipeline error');
      })
    } as any;

    const workflow = new OrchestratorWorkflow(
      repo,
      investigateIncident,
      {} as any,
      {} as any,
      {} as any,
      { broadcast: vi.fn() }
    );

    await expect(workflow.runFullPipeline(incident.id)).resolves.toBeUndefined();
  });

  it('should cover HandleAlert with empty/omitted severity defaulting to critical', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };

    const useCase = new HandleAlert(repo, { broadcast: vi.fn() });
    const res = await useCase.execute({
      alerts: [
        {
          labels: {
            alertname: 'PaymentPoolAlert',
            service: 'api-pagamentos-core',
            severity: ''
          }
        }
      ]
    });

    expect(res.incident.severity).toBe('critical');
  });

  it('should cover InvestigateIncident when seriesCount is 0 and summarizedSeries has p95 <= 2000', async () => {
    const incident = new Incident({
      id: 'inc-investigate-branches',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.INVESTIGATING // already INVESTIGATING to cover transition skip branch
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools: ToolsPort = {
      executePromqlRange: vi.fn(async () => ({
        seriesCount: 0,
        summarizedSeries: [{ metric: {}, p95: 500 }],
        exemplarTraceId: '',
        finops: {} as any
      })),
      queryLokiLogs: vi.fn(async () => ({ linesReturned: 0, logs: [], finops: {} as any })),
      analyzeOtelTrace: vi.fn(async () => ({
        traceId: 'trace-1',
        servicesInvolved: ['svc']
      })),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn()
    };
    const targetStatus: TargetStatusPort = {
      getStatus: vi.fn(async () => ({
        status: 'healthy' as const,
        service: 'api',
        version: 'v2.14.7',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'repo',
        suspectFilePath: 'path',
        rawEdgeLogPreCollector: 'raw'
      })),
      triggerChaos: vi.fn(),
      reset: vi.fn()
    };

    const useCase = new InvestigateIncident(repo, tools, targetStatus, { broadcast: vi.fn() });
    const res = await useCase.execute(incident.id);
    expect(res.hasPromqlAnomaly).toBe(false);
    expect(res.hasMetricExemplar).toBe(false);
  });

  it('should cover NotifyOnCall when incident state is not AWAITING_PR', async () => {
    const incident = new Incident({
      id: 'inc-notify-already-notified',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.NOTIFIED
    });
    const repo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === 'non-existent' ? null : incident)),
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
      sendPostMortemResend: vi.fn(async () => ({ emailId: 'email-1', sentAt: '2026-11-10' })),
      annotateGrafanaIncident: vi.fn()
    };
    const clock: Clock = { now: () => 1730000000000, iso: () => '2026-11-10T12:00:00Z' };

    const useCase = new NotifyOnCall(
      repo,
      tools,
      clock,
      { broadcast: vi.fn() },
      'secret',
      'https://dash'
    );

    const res = await useCase.execute(incident.id);
    expect(res.emailId).toBe('email-1');
  });
});
