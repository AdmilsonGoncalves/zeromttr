import crypto from 'node:crypto';
import { chaosManager } from '../chaos/index.js';

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: {
    code: SpanStatusCode;
    message?: string;
  };
  attributes: Record<string, string | number | boolean>;
}

export interface MetricExemplar {
  traceId: string;
  spanId?: string;
  value: number;
  timestamp: string;
}

export interface MetricRecord {
  name: string;
  value: number;
  attributes: Record<string, string | number | boolean>;
  exemplar?: MetricExemplar;
  timestamp: string;
}

export interface LogRecord {
  timestamp: string;
  traceId?: string;
  spanId?: string;
  severityText: 'INFO' | 'WARN' | 'ERROR';
  body: string;
  attributes: Record<string, string | number | boolean>;
}

export class TelemetryService {
  private static readonly MAX_BUFFERED_RECORDS = 5000;

  private spans: Span[] = [];
  private metrics: MetricRecord[] = [];
  private logs: LogRecord[] = [];
  private otlpEndpoint: string | null = null;

  private pushBounded<T>(buffer: T[], item: T): void {
    buffer.push(item);
    const overflow = buffer.length - TelemetryService.MAX_BUFFERED_RECORDS;
    if (overflow > 0) {
      buffer.splice(0, overflow);
    }
  }

  public constructor() {
    this.otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || null;
  }

  public getServiceName(): string {
    return 'api-pagamentos-core';
  }

  public getServiceVersion(): string {
    return chaosManager.isPoolSaturationEnabled() ? 'v2.14.8' : 'v2.14.7';
  }

  public generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  public startSpan(
    name: string,
    options?: {
      traceId?: string;
      parentSpanId?: string;
      attributes?: Record<string, string | number | boolean>;
    }
  ): Span {
    const traceId = options?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const span: Span = {
      traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
      name,
      startTime: Date.now(),
      status: { code: SpanStatusCode.UNSET },
      attributes: {
        'service.name': this.getServiceName(),
        'service.version': this.getServiceVersion(),
        ...(options?.attributes || {})
      }
    };
    return span;
  }

  public endSpan(
    span: Span,
    status: { code: SpanStatusCode; message?: string } = { code: SpanStatusCode.OK }
  ): void {
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    this.pushBounded(this.spans, span);

    // Asynchronously export to OTel Collector if endpoint configured
    void this.exportSpanToOtlp(span);
  }

  public recordHttpServerDuration(durationSeconds: number, traceId: string): void {
    const exemplar: MetricExemplar = {
      traceId,
      value: durationSeconds,
      timestamp: new Date().toISOString()
    };

    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    // http_server_duration (TECH 03 requirement)
    this.pushBounded(this.metrics, {
      name: 'http_server_duration',
      value: durationSeconds,
      attributes: serviceAttributes,
      exemplar,
      timestamp: new Date().toISOString()
    });

    // http_request_duration_seconds (Grafana alert rule compatibility)
    this.pushBounded(this.metrics, {
      name: 'http_request_duration_seconds',
      value: durationSeconds,
      attributes: serviceAttributes,
      exemplar,
      timestamp: new Date().toISOString()
    });

    void this.exportMetricToOtlp(
      'http_server_duration',
      durationSeconds,
      serviceAttributes,
      exemplar
    );
    void this.exportMetricToOtlp(
      'http_request_duration_seconds',
      durationSeconds,
      serviceAttributes,
      exemplar
    );
  }

  public recordPoolWaiting(waitingCount: number): void {
    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    this.pushBounded(this.metrics, {
      name: 'db_pool_waiting',
      value: waitingCount,
      attributes: serviceAttributes,
      timestamp: new Date().toISOString()
    });

    void this.exportMetricToOtlp('db_pool_waiting', waitingCount, serviceAttributes);
  }

  public recordPoolUsed(usedCount: number): void {
    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    this.pushBounded(this.metrics, {
      name: 'db_pool_used',
      value: usedCount,
      attributes: serviceAttributes,
      timestamp: new Date().toISOString()
    });

    // payment_pool_connections_active (Grafana alert rule compatibility)
    this.pushBounded(this.metrics, {
      name: 'payment_pool_connections_active',
      value: usedCount,
      attributes: serviceAttributes,
      timestamp: new Date().toISOString()
    });

    void this.exportMetricToOtlp('db_pool_used', usedCount, serviceAttributes);
    void this.exportMetricToOtlp('payment_pool_connections_active', usedCount, serviceAttributes);
  }

  public emitLog(
    severity: 'INFO' | 'WARN' | 'ERROR',
    body: string,
    context?: {
      traceId?: string;
      spanId?: string;
      attributes?: Record<string, string | number | boolean>;
    }
  ): void {
    const logRecord: LogRecord = {
      timestamp: new Date().toISOString(),
      traceId: context?.traceId,
      spanId: context?.spanId,
      severityText: severity,
      body,
      attributes: {
        'service.name': this.getServiceName(),
        'service.version': this.getServiceVersion(),
        ...(context?.attributes || {})
      }
    };
    this.pushBounded(this.logs, logRecord);

    void this.exportLogToOtlp(logRecord);
  }

  public getSpans(): Span[] {
    return [...this.spans];
  }

  public getMetrics(): MetricRecord[] {
    return [...this.metrics];
  }

  public getLogs(): LogRecord[] {
    return [...this.logs];
  }

  public clear(): void {
    this.spans = [];
    this.metrics = [];
    this.logs = [];
  }

  private async exportLogToOtlp(log: LogRecord): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    try {
      const url = `${this.otlpEndpoint.replace(/\/$/, '')}/v1/logs`;
      const payload = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: this.getServiceName() } },
                { key: 'service.version', value: { stringValue: this.getServiceVersion() } }
              ]
            },
            scopeLogs: [
              {
                scope: { name: 'api-pagamentos-core' },
                logRecords: [
                  {
                    timeUnixNano: String(Date.now() * 1_000_000),
                    severityText: log.severityText,
                    body: { stringValue: log.body },
                    traceId: log.traceId,
                    spanId: log.spanId,
                    attributes: Object.entries(log.attributes).map(([key, val]) => ({
                      key,
                      value: { stringValue: String(val) }
                    }))
                  }
                ]
              }
            ]
          }
        ]
      };

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000)
      }).catch(() => {
        // Ignore OTLP collector network errors in environments without active collector
      });
    } catch {
      // Ignore background exporter error
    }
  }

  private async exportSpanToOtlp(span: Span): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    try {
      const url = `${this.otlpEndpoint.replace(/\/$/, '')}/v1/traces`;
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: this.getServiceName() } },
                { key: 'service.version', value: { stringValue: this.getServiceVersion() } }
              ]
            },
            scopeSpans: [
              {
                scope: { name: 'api-pagamentos-core' },
                spans: [
                  {
                    traceId: span.traceId,
                    spanId: span.spanId,
                    parentSpanId: span.parentSpanId,
                    name: span.name,
                    startTimeUnixNano: String(span.startTime * 1_000_000),
                    endTimeUnixNano: String((span.endTime || Date.now()) * 1_000_000),
                    status: {
                      code: span.status.code,
                      message: span.status.message
                    },
                    attributes: Object.entries(span.attributes).map(([key, val]) => ({
                      key,
                      value: { stringValue: String(val) }
                    }))
                  }
                ]
              }
            ]
          }
        ]
      };

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000)
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }

  private async exportMetricToOtlp(
    name: string,
    value: number,
    attributes: Record<string, string | number | boolean>,
    exemplar?: MetricExemplar
  ): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    try {
      const url = `${this.otlpEndpoint.replace(/\/$/, '')}/v1/metrics`;
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: this.getServiceName() } },
                { key: 'service.version', value: { stringValue: this.getServiceVersion() } }
              ]
            },
            scopeMetrics: [
              {
                scope: { name: 'api-pagamentos-core' },
                metrics: [
                  {
                    name,
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: String(Date.now() * 1_000_000),
                          asDouble: value,
                          attributes: Object.entries(attributes).map(([key, val]) => ({
                            key,
                            value: { stringValue: String(val) }
                          })),
                          exemplars: exemplar
                            ? [
                                {
                                  timeUnixNano: String(Date.now() * 1_000_000),
                                  asDouble: exemplar.value,
                                  traceId: exemplar.traceId
                                }
                              ]
                            : []
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      };

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000)
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }
}

export const telemetry = new TelemetryService();

export function initTelemetry(): TelemetryService {
  return telemetry;
}
