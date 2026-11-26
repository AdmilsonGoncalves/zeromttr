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
