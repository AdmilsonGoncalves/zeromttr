/**
 * Metric names exported to in-memory buffers and via OTLP to Prometheus/Grafana.
 */
export enum TelemetryMetricName {
  HTTP_SERVER_DURATION = 'http_server_duration',
  HTTP_SERVER_DURATION_MILLISECONDS = 'http_server_duration_milliseconds',
  HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds',
  DB_POOL_WAITING = 'db_pool_waiting',
  DB_POOL_USED = 'db_pool_used',
  PAYMENT_POOL_CONNECTIONS_ACTIVE = 'payment_pool_connections_active'
}

/**
 * OpenTelemetry semantic attribute keys used across spans, logs, and resources.
 */
export enum OtelAttributeKey {
  SERVICE_NAME = 'service.name',
  SERVICE_VERSION = 'service.version'
}

/**
 * UCUM units attached to exported OTLP histograms.
 */
export enum OtelMetricUnit {
  MILLISECONDS = 'ms',
  SECONDS = 's'
}

/**
 * Supported severity levels for OTLP log records emitted by the target service.
 */
export type OtelLogSeverity = 'INFO' | 'WARN' | 'ERROR';

/**
 * Standard OTLP HTTP ingestion signal paths.
 */
export enum OtlpSignalPath {
  LOGS = '/v1/logs',
  TRACES = '/v1/traces',
  METRICS = '/v1/metrics'
}
