/**
 * Canonical service identifier for the target demo application.
 */
export enum TargetServiceIdentity {
  SERVICE_NAME = 'api-pagamentos-core'
}

/**
 * Healthy baseline and controlled-regression release versions for the target service.
 */
export enum TargetReleaseVersion {
  HEALTHY = 'v2.14.7',
  DEGRADED = 'v2.14.8'
}

/**
 * Operational health states emitted by target workload status endpoints.
 */
export enum TargetOpsStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded'
}

/**
 * Health check response statuses specific to the demo target service.
 */
export enum TargetHealthState {
  OK = 'ok',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable'
}

/**
 * Database pool connectivity states reported by `/health`.
 */
export enum TargetDatabaseState {
  CONNECTED = 'connected',
  POOL_SATURATED = 'pool_saturated'
}

/**
 * Custom HTTP headers emitted or consumed exclusively by the demo target service.
 */
export enum TargetHttpHeader {
  SERVICE = 'X-Service',
  TRACE_ID = 'x-trace-id'
}

/**
 * Application error codes returned by payment endpoints in the demo workload.
 */
export enum PaymentErrorCode {
  KNEX_TIMEOUT = 'KnexTimeoutError',
  INTERNAL = 'InternalError'
}
