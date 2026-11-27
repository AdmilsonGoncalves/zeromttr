// Demo Git diff shown in the War Room before live remediation data arrives
export const MOCK_GIT_DIFF = `diff --git a/apps/target-app-demo/src/repositories/payment.repository.ts b/apps/target-app-demo/src/repositories/payment.repository.ts
index e69de29..b898638 100644
--- a/apps/target-app-demo/src/repositories/payment.repository.ts
+++ b/apps/target-app-demo/src/repositories/payment.repository.ts
@@ -24,7 +24,7 @@ export class PaymentRepository {
     pool: {
       min: 2,
       max: 10,
-      acquireTimeoutMillis: 5000,
+      acquireTimeoutMillis: 100, // Regression introduced in v2.14.8
       createTimeoutMillis: 3000,
       idleTimeoutMillis: 30000
     }
`;

// Illustrative raw application log before OTel Collector OTTL redaction
export const RAW_PRE_COLLECTOR_LOG =
  '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 phone 11987654321 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-z: pool connection acquire timeout after 4710ms';

// Illustrative edge-sanitized log after OTel Collector OTTL masking
export const MASKED_POST_OTTL_LOG =
  '2026-11-10T16:20:00.123Z [ERROR] [api-pagamentos-core] [trace_id=4bf92f3577b34da6a3ce929d0e0e4736] Payment failed for payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ] phone [REDACTED_PHONE] Bearer [REDACTED_JWT]: pool connection acquire timeout after 4710ms';

export const TimelineStepStatus = {
  COMPLETED: 'completed',
  IN_PROGRESS: 'in-progress',
  PENDING: 'pending'
} as const;
export type TimelineStepStatus = (typeof TimelineStepStatus)[keyof typeof TimelineStepStatus];

export const UiSeverity = {
  SUCCESS: 'success',
  INFO: 'info',
  WARN: 'warn',
  DANGER: 'danger',
  SECONDARY: 'secondary',
  CONTRAST: 'contrast'
} as const;
export type UiSeverity = (typeof UiSeverity)[keyof typeof UiSeverity];

export const ToastSeverity = {
  SUCCESS: 'success',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
} as const;
export type ToastSeverity = (typeof ToastSeverity)[keyof typeof ToastSeverity];

export const DashboardApiErrorCode = {
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TURNSTILE_PREFIX: 'TURNSTILE_',
  SETTINGS_ADMIN_TOKEN_INVALID: 'SETTINGS_ADMIN_TOKEN_INVALID',
  SETTINGS_READ_ONLY: 'SETTINGS_READ_ONLY'
} as const;

export const FsmStageStatus = {
  COMPLETED: 'completed',
  ACTIVE: 'active',
  PENDING: 'pending',
  FAILED: 'failed'
} as const;
export type FsmStageStatus = (typeof FsmStageStatus)[keyof typeof FsmStageStatus];

export const FsmVirtualState = {
  AWAITING_ALERT: 'AWAITING_ALERT'
} as const;
export type FsmVirtualState = (typeof FsmVirtualState)[keyof typeof FsmVirtualState];

export const DecisionUiStatus = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
} as const;
export type DecisionUiStatus = (typeof DecisionUiStatus)[keyof typeof DecisionUiStatus];

export const TelemetryHealthLevel = {
  HEALTHY: 'healthy',
  WARN: 'warn',
  CRITICAL: 'critical'
} as const;
export type TelemetryHealthLevel = (typeof TelemetryHealthLevel)[keyof typeof TelemetryHealthLevel];

/**
 * Acceptable SLO/health thresholds for target-app-demo live telemetry cards.
 */
export const TARGET_TELEMETRY_THRESHOLDS = {
  THROUGHPUT_SCALE_MAX_RPS: 4,
  THROUGHPUT_WARN_MIN_RPS: 0.5,
  ERROR_5XX_WARN_PERCENT: 1,
  ERROR_5XX_CRITICAL_PERCENT: 5,
  LATENCY_P95_WARN_MS: 250,
  LATENCY_P95_CRITICAL_MS: 500,
  LATENCY_P95_SCALE_MAX_MS: 500,
  POOL_USAGE_WARN_RATIO: 0.7,
  POOL_USAGE_CRITICAL_RATIO: 0.9
} as const;
