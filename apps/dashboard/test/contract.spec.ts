import { describe, it, expect } from 'vitest';
import type {
  Incident,
  IncidentDecisionAction,
  IncidentDecisionSource,
  IncidentDetail,
  IncidentMode,
  IncidentState,
  PiiGuardAudit,
  ReasoningSource,
  SpanNode,
  TargetHealthStatus
} from '../src/app/core/contract.js';

describe('core contract', () => {
  it('should export dedicated domain types without raw string unions', () => {
    const actions: IncidentDecisionAction[] = ['approve', 'reject'];
    const sources: IncidentDecisionSource[] = ['email_hmac', 'demo_simulation'];
    const modes: IncidentMode[] = ['live', 'replay'];
    const reasoningSources: ReasoningSource[] = ['llm', 'fallback'];
    const healthStatuses: TargetHealthStatus[] = ['healthy', 'degraded'];

    expect(actions).toEqual(['approve', 'reject']);
    expect(sources).toEqual(['email_hmac', 'demo_simulation']);
    expect(modes).toEqual(['live', 'replay']);
    expect(reasoningSources).toEqual(['llm', 'fallback']);
    expect(healthStatuses).toEqual(['healthy', 'degraded']);
  });

  it('should define valid Incident and IncidentDetail structures', () => {
    const states: IncidentState[] = [
      'RECEIVED',
      'INVESTIGATING',
      'ENRICHING',
      'REMEDIATING',
      'AWAITING_PR',
      'NOTIFIED',
      'RESOLVED',
      'REJECTED',
      'FAILED'
    ];
    expect(states).toHaveLength(9);

    const span: SpanNode = {
      spanId: 'span-001',
      serviceName: 'api-pagamentos-core',
      operationName: 'pg.pool.acquire',
      durationMs: 4710,
      hasError: true
    };
    expect(span.hasError).toBe(true);

    const audit: PiiGuardAudit = {
      leakedPatternsDetected: 0,
      edgeRedactedTokensVerified: 4,
      passed: true
    };
    expect(audit.passed).toBe(true);

    const incident: Incident = {
      id: 'inc-001',
      service: 'api-pagamentos-core',
      severity: 'CRITICAL',
      state: 'INVESTIGATING',
      mode: 'live',
      startedAt: '2026-11-10T16:20:00Z'
    };
    expect(incident.id).toBe('inc-001');

    const detail: IncidentDetail = {
      ...incident,
      transitions: [
        {
          from: null,
          to: 'RECEIVED',
          at: '2026-11-10T16:20:00Z'
        }
      ],
      rca: {
        summary: 'Pool exhaustion',
        reasoningSource: 'llm',
        evidenceCoveragePercent: 100,
        signalsCollected: 4,
        signalsTotal: 4,
        blastRadius: ['api-pagamentos-core'],
        diagnosisSeconds: 4.7,
        traceId: 'trace-123',
        criticalSpan: 'pg.pool.acquire',
        spans: [span],
        logSample: 'log sample',
        piiGuardAudit: audit,
        mitigations: ['revert']
      }
    };
    expect(detail.rca?.evidenceCoveragePercent).toBe(100);
    expect(detail.rca?.reasoningSource).toBe('llm');
  });
});
