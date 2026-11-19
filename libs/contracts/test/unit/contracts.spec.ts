import { describe, expect, it } from 'vitest';
import {
  AnalyzeOtelTraceInputSchema,
  AnnotateGrafanaIncidentInputSchema,
  CollectedEvidenceSchema,
  CreateRemediationPrInputSchema,
  ExecutePromqlRangeInputSchema,
  FinOpsMetricsSchema,
  IncidentDetailSchema,
  IncidentState,
  InspectGitDeployDiffInputSchema,
  PiiGuardAuditSchema,
  QueryLokiLogsInputSchema,
  RcaAndPatchSynthesisSchema,
  ReplaySnapshotSchema,
  SearchTracesByTraceqlInputSchema,
  SendPostMortemResendInputSchema,
  TargetHealthStatus
} from '../../src/index.js';

describe('@zeromttr/contracts Zod schemas', () => {
  it('should_validate_finops_metrics_happy_and_unhappy_paths', () => {
    const valid = FinOpsMetricsSchema.safeParse({
      rawBytesFetched: 48200,
      compactedBytesSentToLlm: 2890,
      payloadReductionPercent: 94,
      estimatedTokensSaved: 11328
    });
    expect(valid.success).toBe(true);

    const invalid = FinOpsMetricsSchema.safeParse({
      rawBytesFetched: -1,
      compactedBytesSentToLlm: 100,
      payloadReductionPercent: 120,
      estimatedTokensSaved: 10
    });
    expect(invalid.success).toBe(false);
  });

  it('should_validate_all_8_mcp_tool_input_schemas_with_defaults', () => {
    const promql = ExecutePromqlRangeInputSchema.parse({
      query: 'up',
      start: '2026-11-18T00:00:00Z',
      end: '2026-11-18T01:00:00Z'
    });
    expect(promql.step).toBe('15s');
    expect(
      ExecutePromqlRangeInputSchema.safeParse({
        query: 'up',
        start: 1795000000,
        end: 1795003600
      }).success
    ).toBe(false);

    const trace = AnalyzeOtelTraceInputSchema.safeParse({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736'
    });
    expect(trace.success).toBe(true);
    expect(AnalyzeOtelTraceInputSchema.safeParse({ trace_id: 'short' }).success).toBe(false);

    const traceql = SearchTracesByTraceqlInputSchema.parse({ query: '{status=error}' });
    expect(traceql.limit).toBe(5);

    const loki = QueryLokiLogsInputSchema.parse({
      logql: '{service="api-pagamentos-core"}',
      start: '2026-11-18T00:00:00Z',
      end: '2026-11-18T00:05:00Z'
    });
    expect(loki.limit).toBe(50);
    expect(
      QueryLokiLogsInputSchema.safeParse({
        logql: '{service="api-pagamentos-core"}',
        start: 1795000000,
        end: 1795003600
      }).success
    ).toBe(false);

    const diff = InspectGitDeployDiffInputSchema.parse({
      base_ref: 'v2.14.7',
      head_ref: 'v2.14.8'
    });
    expect(diff.service_path).toBe('apps/target-app-demo');

    expect(
      CreateRemediationPrInputSchema.safeParse({
        incident_id: 'inc-1',
        file_path: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patched_content: 'export const ok = true;',
        title: 'fix(db): restore pool',
        rca_markdown: 'RCA details',
        reasoning_source: 'llm'
      }).success
    ).toBe(true);

    expect(
      SendPostMortemResendInputSchema.safeParse({
        incident_id: 'inc-1',
        recipient_email: 'sre@example.com',
        title: '[Post-Mortem] inc-1',
        rca_summary: 'Pool exhausted',
        evidence_coverage: '4/4 Signals (100%)',
        reasoning_source: 'llm',
        blast_radius: ['api-pagamentos-core'],
        regression_commit: 'v2.14.7...v2.14.8',
        pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
        approve_url: 'http://localhost:4200/decision/inc-1#action=approve&sig=abc&exp=1',
        reject_url: 'http://localhost:4200/decision/inc-1#action=reject&sig=def&exp=1',
        leaked_patterns_detected: 0
      }).success
    ).toBe(true);
    expect(
      SendPostMortemResendInputSchema.safeParse({
        incident_id: 'inc-1',
        title: '[Post-Mortem] inc-1',
        rca_summary: 'Pool exhausted',
        evidence_coverage: '4/4',
        reasoning_source: 'llm',
        blast_radius: ['api-pagamentos-core'],
        regression_commit: 'v2.14.7...v2.14.8',
        pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
        approve_url: 'not-a-valid-url',
        reject_url: 'http://localhost:4200/decision/inc-1#action=reject&sig=def&exp=1'
      }).success
    ).toBe(false);
    expect(
      SendPostMortemResendInputSchema.safeParse({
        incident_id: 'inc-1',
        title: '[Post-Mortem] inc-1',
        rca_summary: 'Pool exhausted',
        evidence_coverage: '4/4',
        reasoning_source: 'llm',
        blast_radius: ['api-pagamentos-core'],
        regression_commit: 'v2.14.7...v2.14.8',
        pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
        approve_url: 'http://localhost:4200/decision/inc-1#action=approve&sig=abc&exp=1'
      }).success
    ).toBe(false);

    expect(
      AnnotateGrafanaIncidentInputSchema.safeParse({
        time: 1795000000,
        text: 'Hotfix opened',
        tags: ['aiops-remediation']
      }).success
    ).toBe(true);
  });

  it('should_validate_llm_collected_evidence_and_rca_patch_synthesis', () => {
    const evidence = CollectedEvidenceSchema.safeParse({
      incidentId: 'inc-1',
      service: 'api-pagamentos-core',
      alertName: 'PaymentServicePoolExhaustion',
      promqlSummary: {
        metric: 'http_server_duration_milliseconds_bucket',
        p95LatencyMs: 4512,
        dbPoolWaiting: 8
      },
      traceAnalysis: {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        criticalOperation: 'pg.pool.acquire',
        durationMs: 4500,
        errorMessage: 'KnexTimeoutError',
        servicesInvolved: ['api-pagamentos-core', 'postgres']
      },
      logSample: 'ERROR [REDACTED_CPF]',
      gitDiff: {
        baseRef: 'v2.14.7',
        headRef: 'v2.14.8',
        suspectCommit: '8f14e45',
        authorLogin: 'dev-bot',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patch: '- max: 10\n+ max: 2'
      }
    });
    expect(evidence.success).toBe(true);

    const synthesis = RcaAndPatchSynthesisSchema.safeParse({
      summary: 'Saturação do pool de conexões.',
      rootCause: 'Falta client.release() no timeout.',
      evidenceRefs: ['4bf92f3577b34da6a3ce929d0e0e4736', '8f14e45'],
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patchedContent: 'const pool = { max: 10 };',
      explanation: 'Restaura max: 10 e finally { client.release(); }.'
    });
    expect(synthesis.success).toBe(true);

    expect(
      RcaAndPatchSynthesisSchema.safeParse({
        summary: 'Only summary'
      }).success
    ).toBe(false);

    // Reject extra unexpected fields (strict 6-field contract)
    expect(
      RcaAndPatchSynthesisSchema.safeParse({
        summary: 'Saturação do pool de conexões.',
        rootCause: 'Falta client.release() no timeout.',
        evidenceRefs: ['4bf92f3577b34da6a3ce929d0e0e4736'],
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patchedContent: 'const pool = { max: 10 };',
        explanation: 'Restaura max: 10.',
        reasoningSource: 'llm',
        extraField: 'unexpected'
      }).success
    ).toBe(false);
  });

  it('should_validate_incident_detail_and_require_detected_types_in_pii_audit', () => {
    expect(
      PiiGuardAuditSchema.safeParse({
        leakedPatternsDetected: 0,
        edgeRedactedTokensVerified: 4,
        passed: true
      }).success
    ).toBe(false);

    const detail = IncidentDetailSchema.safeParse({
      id: 'inc-1',
      service: 'api-pagamentos-core',
      severity: 'critical',
      state: IncidentState.NOTIFIED,
      mode: 'live',
      startedAt: '2026-11-18T20:00:00.000Z',
      transitions: [
        {
          from: null,
          to: IncidentState.RECEIVED,
          at: '2026-11-18T20:00:00.000Z'
        }
      ],
      rca: {
        summary: 'Pool exhausted',
        rootCause: 'Missing client.release()',
        reasoningSource: 'llm',
        evidenceCoveragePercent: 100,
        signalsCollected: 4,
        signalsTotal: 4,
        blastRadius: ['api-pagamentos-core', 'postgres'],
        diagnosisSeconds: 5,
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        criticalSpan: 'pg.pool.acquire',
        spans: [
          {
            spanId: 'span-1',
            serviceName: 'api-pagamentos-core',
            operationName: 'pg.pool.acquire',
            durationMs: 4500,
            hasError: true,
            errorMessage: 'KnexTimeoutError'
          }
        ],
        logSample: '[REDACTED_CPF]',
        piiGuardAudit: {
          leakedPatternsDetected: 0,
          detectedTypes: [],
          edgeRedactedTokensVerified: 4,
          passed: true
        },
        mitigations: ['Restore finally { client.release(); }']
      }
    });
    expect(detail.success).toBe(true);
    expect(TargetHealthStatus.UNREACHABLE).toBe('unreachable');
  });

  it('should_validate_replay_snapshot_schema_from_tech_09_section_6', () => {
    const validReplay = ReplaySnapshotSchema.safeParse({
      recordedAt: '2026-11-07T18:00:00.000Z',
      incidentId: 'inc-live-demo-golden',
      service: 'api-pagamentos-core',
      severity: 'critical',
      evidenceCoverage: {
        score: 100,
        signalsCollected: 4,
        signalsTotal: 4,
        signals: ['promql_anomaly', 'metric_exemplar', 'tempo_error_span', 'loki_log_diff']
      },
      blastRadius: {
        servicesInvolved: ['api-pagamentos-core', 'postgres']
      },
      finops: {
        rawBytesFetched: 48200,
        compactedBytesSentToLlm: 2890,
        payloadReductionPercent: 94,
        estimatedTokensSaved: 11328
      },
      piiGuardAudit: {
        leakedPatternsDetected: 0,
        detectedTypes: [],
        edgeRedactedTokensVerified: 4,
        passed: true
      },
      rca: {
        summary: 'Degradação crítica com p95 > 4.5s.',
        rootCause: 'Commit removeu client.release() e reduziu pool max para 2.',
        reasoningSource: 'llm',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts'
      },
      remediation: {
        branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-demo-golden',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
        commitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4'
      },
      eventsTimeline: [
        { event: 'incident.created', delayMs: 500 },
        { event: 'incident.transition', state: 'INVESTIGATING', delayMs: 2000 }
      ]
    });
    expect(validReplay.success).toBe(true);

    const invalidEventName = ReplaySnapshotSchema.safeParse({
      ...(validReplay.success ? validReplay.data : {}),
      eventsTimeline: [{ event: 'incident.rac', delayMs: 500 }]
    });
    expect(invalidEventName.success).toBe(false);

    const missingTransitionState = ReplaySnapshotSchema.safeParse({
      ...(validReplay.success ? validReplay.data : {}),
      eventsTimeline: [{ event: 'incident.transition', delayMs: 500 }]
    });
    expect(missingTransitionState.success).toBe(false);
  });
});
