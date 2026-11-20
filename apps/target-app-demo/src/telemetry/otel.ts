import crypto from 'node:crypto';
import { chaosManager } from '../chaos/chaos.manager.js';
import { TargetReleaseVersion, TargetServiceIdentity } from '../chaos/target-metadata-enums.js';
import { millisToUnixNano, nowIso, nowUnixNano } from '@zeromttr/utils';
import { buildUrl } from '@zeromttr/utils/http';
import {
  OtelAttributeKey,
  OtelMetricUnit,
  OtlpSignalPath,
  TelemetryMetricName,
  type OtelLogSeverity
} from './telemetry-enums.js';

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
  severityText: OtelLogSeverity;
  body: string;
  attributes: Record<string, string | number | boolean>;
}

interface OtlpResource {
  attributes: Array<{ key: OtelAttributeKey; value: { stringValue: string } }>;
}

interface HistogramState {
  key: string;
  name: TelemetryMetricName;
  unit: OtelMetricUnit;
  startTimeUnixNano: string;
  count: number;
  sum: number;
  bounds: number[];
  bucketCounts: number[];
  attributes: Record<string, string | number | boolean>;
  resource: OtlpResource;
  scope: { name: string };
  lastExportMs: number;
  inFlight: boolean;
  pendingFlush: boolean;
  pendingExemplar?: {
    traceId: string;
    value: number;
  };
  flushTimer?: ReturnType<typeof setTimeout>;
}

/**
 * OpenTelemetry emitter managing bounded spans, histograms with exemplars, logs, and OTLP HTTP export.
 */
export class TelemetryService {
  private static readonly MAX_BUFFERED_RECORDS = 5000;
  private static readonly SECONDS_BOUNDS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  private static readonly MILLIS_BOUNDS = [50, 100, 250, 500, 1000, 2000, 5000, 10000];

  private spans: Span[] = [];
  private metrics: MetricRecord[] = [];
  private logs: LogRecord[] = [];
  private histograms = new Map<string, HistogramState>();
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

  /**
   * Returns the configured OpenTelemetry service name.
   */
  public getServiceName(): string {
    return TargetServiceIdentity.SERVICE_NAME;
  }

  /**
   * Returns the active release version tag (`v2.14.8` in chaos mode or `v2.14.7` baseline).
   */
  public getServiceVersion(): string {
    return chaosManager.isPoolSaturationEnabled()
      ? TargetReleaseVersion.DEGRADED
      : TargetReleaseVersion.HEALTHY;
  }

  /**
   * Generates a random 16-byte W3C trace ID hex string.
   */
  public generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generates a random 8-byte OpenTelemetry span ID hex string.
   */
  public generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Starts a new OpenTelemetry span with service metadata and optional parent/attributes.
   */
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
        [OtelAttributeKey.SERVICE_NAME]: this.getServiceName(),
        [OtelAttributeKey.SERVICE_VERSION]: this.getServiceVersion(),
        ...(options?.attributes || {})
      }
    };
    return span;
  }

  /**
   * Completes a span, stores it in the bounded buffer, and exports it via OTLP when configured.
   */
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

  /**
   * Records HTTP request duration metrics and exemplar histograms in milliseconds and seconds.
   */
  public recordHttpServerDuration(durationSeconds: number, traceId: string): void {
    const exemplar: MetricExemplar = {
      traceId,
      value: durationSeconds,
      timestamp: nowIso()
    };

    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    // http_server_duration (TECH 03 requirement)
    this.pushBounded(this.metrics, {
      name: TelemetryMetricName.HTTP_SERVER_DURATION,
      value: durationSeconds,
      attributes: serviceAttributes,
      exemplar,
      timestamp: nowIso()
    });

    // http_request_duration_seconds (Grafana alert rule compatibility)
    this.pushBounded(this.metrics, {
      name: TelemetryMetricName.HTTP_REQUEST_DURATION_SECONDS,
      value: durationSeconds,
      attributes: serviceAttributes,
      exemplar,
      timestamp: nowIso()
    });

    void this.exportHistogramToOtlp(
      TelemetryMetricName.HTTP_SERVER_DURATION_MILLISECONDS,
      OtelMetricUnit.MILLISECONDS,
      durationSeconds * 1000,
      TelemetryService.MILLIS_BOUNDS,
      serviceAttributes,
      exemplar
    );
    void this.exportHistogramToOtlp(
      TelemetryMetricName.HTTP_REQUEST_DURATION_SECONDS,
      OtelMetricUnit.SECONDS,
      durationSeconds,
      TelemetryService.SECONDS_BOUNDS,
      serviceAttributes,
      exemplar
    );
  }

  /**
   * Records the number of callers queued for a database pool connection.
   */
  public recordPoolWaiting(waitingCount: number): void {
    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    this.pushBounded(this.metrics, {
      name: TelemetryMetricName.DB_POOL_WAITING,
      value: waitingCount,
      attributes: serviceAttributes,
      timestamp: nowIso()
    });

    void this.exportMetricToOtlp(
      TelemetryMetricName.DB_POOL_WAITING,
      waitingCount,
      serviceAttributes
    );
  }

  /**
   * Records active database connection counts across `db.pool.used` and pool active metrics.
   */
  public recordPoolUsed(usedCount: number): void {
    const serviceAttributes = {
      service: this.getServiceName(),
      version: this.getServiceVersion()
    };

    this.pushBounded(this.metrics, {
      name: TelemetryMetricName.DB_POOL_USED,
      value: usedCount,
      attributes: serviceAttributes,
      timestamp: nowIso()
    });

    // payment_pool_connections_active (Grafana alert rule compatibility)
    this.pushBounded(this.metrics, {
      name: TelemetryMetricName.PAYMENT_POOL_CONNECTIONS_ACTIVE,
      value: usedCount,
      attributes: serviceAttributes,
      timestamp: nowIso()
    });

    void this.exportMetricToOtlp(TelemetryMetricName.DB_POOL_USED, usedCount, serviceAttributes);
    void this.exportMetricToOtlp(
      TelemetryMetricName.PAYMENT_POOL_CONNECTIONS_ACTIVE,
      usedCount,
      serviceAttributes
    );
  }

  /**
   * Buffers a structured telemetry log record and exports it via OTLP when configured.
   */
  public emitLog(
    severity: OtelLogSeverity,
    body: string,
    context?: {
      traceId?: string;
      spanId?: string;
      attributes?: Record<string, string | number | boolean>;
    }
  ): void {
    const logRecord: LogRecord = {
      timestamp: nowIso(),
      traceId: context?.traceId,
      spanId: context?.spanId,
      severityText: severity,
      body,
      attributes: {
        [OtelAttributeKey.SERVICE_NAME]: this.getServiceName(),
        [OtelAttributeKey.SERVICE_VERSION]: this.getServiceVersion(),
        ...(context?.attributes || {})
      }
    };
    this.pushBounded(this.logs, logRecord);

    void this.exportLogToOtlp(logRecord);
  }

  /**
   * Returns a copy of buffered OpenTelemetry spans.
   */
  public getSpans(): Span[] {
    return [...this.spans];
  }

  /**
   * Returns a copy of buffered metric records.
   */
  public getMetrics(): MetricRecord[] {
    return [...this.metrics];
  }

  /**
   * Returns a copy of buffered telemetry log records.
   */
  public getLogs(): LogRecord[] {
    return [...this.logs];
  }

  /**
   * Clears buffered telemetry records and cancels pending histogram flush timers.
   */
  public clear(): void {
    for (const state of this.histograms.values()) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
      }
    }
    this.spans = [];
    this.metrics = [];
    this.logs = [];
    this.histograms.clear();
  }

  private buildOtlpResource(): OtlpResource {
    return {
      attributes: [
        { key: OtelAttributeKey.SERVICE_NAME, value: { stringValue: this.getServiceName() } },
        { key: OtelAttributeKey.SERVICE_VERSION, value: { stringValue: this.getServiceVersion() } }
      ]
    };
  }

  private buildOtlpScope(): { name: string } {
    return { name: this.getServiceName() };
  }

  private async postOtlpPayload(path: OtlpSignalPath, payload: unknown): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    try {
      const url = buildUrl(this.otlpEndpoint, path);
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

  private async exportLogToOtlp(log: LogRecord): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    const payload = {
      resourceLogs: [
        {
          resource: this.buildOtlpResource(),
          scopeLogs: [
            {
              scope: this.buildOtlpScope(),
              logRecords: [
                {
                  timeUnixNano: nowUnixNano(),
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

    await this.postOtlpPayload(OtlpSignalPath.LOGS, payload);
  }

  private async exportSpanToOtlp(span: Span): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    const payload = {
      resourceSpans: [
        {
          resource: this.buildOtlpResource(),
          scopeSpans: [
            {
              scope: this.buildOtlpScope(),
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentSpanId,
                  name: span.name,
                  startTimeUnixNano: millisToUnixNano(span.startTime),
                  endTimeUnixNano: millisToUnixNano(span.endTime || Date.now()),
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

    await this.postOtlpPayload(OtlpSignalPath.TRACES, payload);
  }

  private async exportMetricToOtlp(
    name: TelemetryMetricName,
    value: number,
    attributes: Record<string, string | number | boolean>,
    exemplar?: MetricExemplar
  ): Promise<void> {
    if (!this.otlpEndpoint) {
      return;
    }
    const payload = {
      resourceMetrics: [
        {
          resource: this.buildOtlpResource(),
          scopeMetrics: [
            {
              scope: this.buildOtlpScope(),
              metrics: [
                {
                  name,
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: nowUnixNano(),
                        asDouble: value,
                        attributes: Object.entries(attributes).map(([key, val]) => ({
                          key,
                          value: { stringValue: String(val) }
                        })),
                        exemplars: exemplar
                          ? [
                              {
                                timeUnixNano: nowUnixNano(),
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

    await this.postOtlpPayload(OtlpSignalPath.METRICS, payload);
  }

  private async exportHistogramToOtlp(
    name: TelemetryMetricName,
    unit: OtelMetricUnit,
    value: number,
    bounds: number[],
    attributes: Record<string, string | number | boolean>,
    exemplar?: MetricExemplar
  ): Promise<void> {
    const key = `${name}:${JSON.stringify(attributes)}`;
    let state = this.histograms.get(key);
    if (!state) {
      state = {
        key,
        name,
        unit,
        startTimeUnixNano: nowUnixNano(),
        count: 0,
        sum: 0,
        bounds,
        bucketCounts: new Array<number>(bounds.length + 1).fill(0),
        attributes,
        resource: this.buildOtlpResource(),
        scope: this.buildOtlpScope(),
        lastExportMs: 0,
        inFlight: false,
        pendingFlush: false
      };
      this.histograms.set(key, state);
    }

    state.count += 1;
    state.sum += value;
    let bucketIndex = bounds.findIndex((bound) => value <= bound);
    if (bucketIndex === -1) {
      bucketIndex = bounds.length;
    }
    state.bucketCounts[bucketIndex] += 1;
    if (exemplar) {
      state.pendingExemplar = {
        traceId: exemplar.traceId,
        value
      };
    }

    if (!this.otlpEndpoint) {
      return;
    }

    if (state.inFlight) {
      state.pendingFlush = true;
      return;
    }

    if (!state.flushTimer) {
      this.scheduleHistogramFlush(state);
    }
  }

  private scheduleHistogramFlush(state: HistogramState): void {
    const delayMs = Math.max(1, state.lastExportMs + 1 - Date.now());
    state.flushTimer = setTimeout(() => {
      void this.flushHistogramSnapshot(state);
    }, delayMs);
    state.flushTimer.unref?.();
  }

  private async flushHistogramSnapshot(state: HistogramState): Promise<void> {
    state.flushTimer = undefined;
    if (!this.otlpEndpoint) {
      return;
    }

    state.inFlight = true;
    state.pendingFlush = false;

    const exportMs = Math.max(Date.now(), state.lastExportMs + 1);
    state.lastExportMs = exportMs;
    const nowNano = String(BigInt(exportMs) * 1_000_000n);
    const exemplar = state.pendingExemplar;
    state.pendingExemplar = undefined;

    const payload = {
      resourceMetrics: [
        {
          resource: state.resource,
          scopeMetrics: [
            {
              scope: state.scope,
              metrics: [
                {
                  name: state.name,
                  unit: state.unit,
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        startTimeUnixNano: state.startTimeUnixNano,
                        timeUnixNano: nowNano,
                        count: String(state.count),
                        sum: state.sum,
                        bucketCounts: state.bucketCounts.map((c) => String(c)),
                        explicitBounds: state.bounds,
                        attributes: Object.entries(state.attributes).map(([k, val]) => ({
                          key: k,
                          value: { stringValue: String(val) }
                        })),
                        exemplars: exemplar
                          ? [
                              {
                                timeUnixNano: nowNano,
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

    try {
      await this.postOtlpPayload(OtlpSignalPath.METRICS, payload);
    } finally {
      state.inFlight = false;
      if (state.pendingFlush && this.histograms.get(state.key) === state && !state.flushTimer) {
        this.scheduleHistogramFlush(state);
      }
    }
  }
}

export const telemetry = new TelemetryService();

/**
 * Returns the singleton `TelemetryService` instance for target app instrumentation.
 */
export function initTelemetry(): TelemetryService {
  return telemetry;
}
