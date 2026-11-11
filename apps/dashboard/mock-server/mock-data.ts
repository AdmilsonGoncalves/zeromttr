import type { IncidentDetail, TargetStatusResponse } from '../src/app/core/contract.js';

export const INITIAL_TARGET_STATUS: TargetStatusResponse = {
  status: 'degraded',
  service: 'api-pagamentos-core',
  version: 'v2.14.8',
  previousHealthyVersion: 'v2.14.7',
  rawEdgeLogPreCollector:
    '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 phone 11987654321 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-z: pool connection acquire timeout after 4710ms'
};

export const HEALTHY_TARGET_STATUS: TargetStatusResponse = {
  status: 'healthy',
  service: 'api-pagamentos-core',
  version: 'v2.14.7',
  previousHealthyVersion: 'v2.14.7'
};

export const MOCK_INCIDENT: IncidentDetail = {
  id: 'inc-20261110-001',
  service: 'api-pagamentos-core',
  severity: 'CRITICAL',
  state: 'NOTIFIED',
  mode: 'live',
  startedAt: '2026-11-10T16:20:00Z',
  transitions: [
    {
      from: null,
      to: 'RECEIVED',
      at: '2026-11-10T16:20:00.100Z',
      reason: 'Grafana latency p99 webhook'
    },
    {
      from: 'RECEIVED',
      to: 'INVESTIGATING',
      at: '2026-11-10T16:20:02.300Z',
      reason: 'PromQL range + Exemplar query'
    },
    {
      from: 'INVESTIGATING',
      to: 'ENRICHING',
      at: '2026-11-10T16:20:04.700Z',
      reason: 'Tempo trace + Loki logs + GitHub diff'
    },
    {
      from: 'ENRICHING',
      to: 'REMEDIATING',
      at: '2026-11-10T16:20:05.100Z',
      reason: 'PiiPromptGuard verified (0 leaked)'
    },
    {
      from: 'REMEDIATING',
      to: 'AWAITING_PR',
      at: '2026-11-10T16:20:12.400Z',
      reason: 'Gemini synthesis & hotfix PR creation'
    },
    {
      from: 'AWAITING_PR',
      to: 'NOTIFIED',
      at: '2026-11-10T16:20:18.200Z',
      reason: 'Resend post-mortem dispatched'
    }
  ],
  rca: {
    summary:
      'Connection pool exhaustion detected in api-pagamentos-core due to acquireTimeoutMs reduction from 5000ms to 100ms in commit 7a8b9c (v2.14.8). Under concurrent traffic, pg.pool.acquire exceeds 100ms causing 500 errors.',
    reasoningSource: 'llm',
    evidenceCoveragePercent: 100,
    signalsCollected: 4,
    signalsTotal: 4,
    evidenceBreakdown: {
      promql: 25,
      exemplar: 25,
      tempoSpan: 25,
      lokiAndDiff: 25
    },
    blastRadius: ['api-pagamentos-core', 'postgres-pagamentos'],
    diagnosisSeconds: 4.7,
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    criticalSpan: 'pg.pool.acquire (4.71s ERROR)',
    spans: [
      {
        spanId: 'span-root-01',
        serviceName: 'api-pagamentos-core',
        operationName: 'POST /api/payments',
        durationMs: 5012,
        hasError: true
      },
      {
        spanId: 'span-auth-02',
        parentSpanId: 'span-root-01',
        serviceName: 'api-pagamentos-core',
        operationName: 'auth.validate-jwt',
        durationMs: 12,
        hasError: false
      },
      {
        spanId: 'span-db-03',
        parentSpanId: 'span-root-01',
        serviceName: 'api-pagamentos-core',
        operationName: 'pg.pool.acquire (4.71s ERROR)',
        durationMs: 4710,
        hasError: true
      },
      {
        spanId: 'span-db-04',
        parentSpanId: 'span-db-03',
        serviceName: 'postgres-pagamentos',
        operationName: 'db.query.insert',
        durationMs: 0,
        hasError: true
      }
    ],
    rawEdgeLogPreCollector:
      '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 phone 11987654321 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-z: pool connection acquire timeout after 4710ms',
    logSample:
      '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ] phone [REDACTED_PHONE] Bearer [REDACTED_JWT]: pool connection acquire timeout after 4710ms',
    piiGuardAudit: {
      leakedPatternsDetected: 0,
      edgeRedactedTokensVerified: 4,
      passed: true
    },
    deployVersion: 'v2.14.8',
    mitigations: [
      'Revert acquireTimeoutMs from 100ms back to 5000ms in payment.repository.ts',
      'Increase Knex pool max connections to 20 for high-concurrency spikes',
      'Add healthcheck probe on connection pool availability'
    ],
    grafanaAnnotationId: 1042
  },
  finops: {
    rawBytesFetched: 48200,
    compactedBytesSent: 7712,
    payloadReductionPercent: 84,
    estimatedTokensSaved: 10122
  },
  docs: [
    {
      url: 'https://knexjs.org/guide/interfaces.html#pool',
      title: 'Knex Connection Pool Configuration Best Practices',
      markdownExcerpt:
        'Setting acquireTimeoutMillis too low under spiky load can cause immediate pool exhaustion errors before worker threads get a chance to yield connection.'
    }
  ],
  remediation: {
    branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-pool-timeout',
    pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
    commitSha: 'c0ffee1234567890abcdef1234567890abcdef12'
  },
  notification: {
    emailId: 're_abc12345',
    htmlPreview: `
      <div style="font-family: sans-serif; color: #0f172a; padding: 16px;">
        <h2 style="color: #dc2626;">🚨 ZeroMTTR Incident Post-Mortem & Approval Request</h2>
        <p><strong>Incident ID:</strong> inc-20261110-001</p>
        <p><strong>Service:</strong> api-pagamentos-core (v2.14.8)</p>
        <p><strong>Root Cause:</strong> Connection pool acquire timeout regression in payment.repository.ts</p>
        <p><strong>Pull Request:</strong> <a href="https://github.com/AdmilsonGoncalves/zeromttr/pull/42" target="_blank">#42 hotfix/zeromttr-pool-timeout</a></p>
        <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
          <p style="font-size: 13px; color: #475569;">
            Decisão requerida via link assinado com HMAC enviado com exclusividade neste e-mail.
          </p>
        </div>
      </div>
    `
  }
};

import {
  MOCK_GIT_DIFF,
  RAW_PRE_COLLECTOR_LOG,
  MASKED_POST_OTTL_LOG
} from '../src/app/core/constants.js';

export { MOCK_GIT_DIFF, RAW_PRE_COLLECTOR_LOG, MASKED_POST_OTTL_LOG };
