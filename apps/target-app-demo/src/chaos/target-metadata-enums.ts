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
