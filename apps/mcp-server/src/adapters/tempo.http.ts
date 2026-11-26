import {
  isArray,
  isFilled,
  isNumber,
  isObject,
  isString,
  parseIsoDate,
  round,
  safeJsonParse
} from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import type { TracesPort, TraceSearchResult, TraceSearchWindow } from '../ports/traces.port.js';
import { extractOtelAttributeValue, type RawSpan } from '../domain/span-analysis.js';

export interface TempoAdapterConfig {
  baseUrl: string;
}

interface ScopeSpanHolder {
  spans?: Array<{
    spanId?: string;
    id?: string;
    traceId?: string;
    parentSpanId?: string;
    parentId?: string;
    name?: string;
    operationName?: string;
    durationMs?: number;
    startTimeUnixNano?: string | number;
    endTimeUnixNano?: string | number;
    status?: { code?: string | number; message?: string };
    statusCode?: string | number;
    statusMessage?: string;
    attributes?: Array<{ key: string; value: unknown }> | Record<string, unknown>;
  }>;
}

interface BatchSpanHolder {
  resource?: { attributes?: Array<{ key: string; value: unknown }> };
  scopeSpans?: ScopeSpanHolder[];
  instrumentationLibrarySpans?: ScopeSpanHolder[];
}

/**
 * Grafana Tempo HTTP adapter fetching OpenTelemetry trace spans and running TraceQL searches.
 */
export class TempoHttpAdapter implements TracesPort {
  constructor(private readonly config: TempoAdapterConfig) {}

  /**
   * Fetches and normalizes all OpenTelemetry spans for a trace ID from Tempo.
   */
  async getTrace(traceId: string): Promise<{ rawBytes: number; spans: RawSpan[] }> {
    const url = buildUrl(this.config.baseUrl, `/api/traces/${traceId}`);
    const response = await fetch(url, {
      headers: { [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON }
    });

    if (!isHttpSuccess(response.status)) {
      throw new Error(`Tempo getTrace failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    const data = safeJsonParse<{
      batches?: BatchSpanHolder[];
      resourceSpans?: BatchSpanHolder[];
    }>(text);
    if (!data) {
      throw new Error('Failed to parse Tempo trace JSON');
    }

    const spans: RawSpan[] = [];
    const resourceSpans = data.batches || data.resourceSpans || [];

    for (const batch of resourceSpans) {
      let defaultServiceName = 'unknown-service';
      const resourceAttrs = batch.resource?.attributes || [];
      if (isArray(resourceAttrs)) {
        const svcAttr = resourceAttrs.find((a) => a.key === 'service.name' || a.key === 'service');
        if (svcAttr) {
          defaultServiceName = String(
            extractOtelAttributeValue(svcAttr.value) || defaultServiceName
          );
        }
      }

      const scopeSpans = batch.scopeSpans || batch.instrumentationLibrarySpans || [];
      for (const scope of scopeSpans) {
        const batchSpans = scope.spans || [];
        for (const s of batchSpans) {
          const attributes: Record<string, unknown> = {};
          if (isArray(s.attributes)) {
            for (const attr of s.attributes) {
              if (attr && isString(attr.key)) {
                attributes[attr.key] = extractOtelAttributeValue(attr.value);
              }
            }
          } else if (isObject(s.attributes)) {
            for (const [k, v] of Object.entries(s.attributes)) {
              attributes[k] = extractOtelAttributeValue(v);
            }
          }

          const serviceName = isString(attributes['service.name'])
            ? attributes['service.name']
            : defaultServiceName;

          let durationMs = 0;
          if (s.durationMs !== undefined) {
            durationMs = Number(s.durationMs);
          } else if (s.startTimeUnixNano && s.endTimeUnixNano) {
            const startNano = BigInt(s.startTimeUnixNano);
            const endNano = BigInt(s.endTimeUnixNano);
            durationMs = Number(endNano - startNano) / 1_000_000;
          }

          spans.push({
            spanId: s.spanId || s.id || '',
            traceId: s.traceId || traceId,
            parentSpanId: s.parentSpanId || s.parentId,
            name: s.name || s.operationName || 'unnamed-span',
            serviceName,
            durationMs: round(durationMs),
            statusCode: s.status?.code ?? s.statusCode,
            statusMessage: s.status?.message ?? s.statusMessage,
            attributes
          });
        }
      }
    }

    return { rawBytes, spans };
  }

  private toEpochSeconds(iso?: string): number | undefined {
    const parsed = parseIsoDate(iso);
    if (!parsed) {
      return undefined;
    }
    return Math.floor(parsed.getTime() / 1000);
  }

  /**
   * Searches traces in Tempo using TraceQL and an optional bounded time window.
   */
  async searchTraces(
    query: string,
    limit = 10,
    window?: TraceSearchWindow
  ): Promise<{ rawBytes: number; traces: TraceSearchResult[] }> {
    let startSec = this.toEpochSeconds(window?.start);
    let endSec = this.toEpochSeconds(window?.end);
    if (isNumber(startSec) && !isNumber(endSec)) {
      endSec = Math.floor(Date.now() / 1000);
    } else if (!isNumber(startSec) && isNumber(endSec)) {
      startSec = Math.max(0, endSec - 300);
    }
    const url = buildUrl(this.config.baseUrl, '/api/search', {
      q: query,
      limit,
      start: startSec,
      end: endSec
    });
    const response = await fetch(url, {
      headers: { [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON }
    });

    if (!isHttpSuccess(response.status)) {
      throw new Error(`Tempo searchTraces failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    const data = safeJsonParse<{
      traces?: Array<{
        traceID?: string;
        traceId?: string;
        rootServiceName?: string;
        rootTraceName?: string;
        startTimeUnixNano?: string | number;
        durationMs?: number;
      }>;
      results?: Array<{
        traceID?: string;
        traceId?: string;
        rootServiceName?: string;
        rootTraceName?: string;
        startTimeUnixNano?: string | number;
        durationMs?: number;
      }>;
    }>(text);
    if (!data) {
      throw new Error('Failed to parse Tempo search JSON');
    }

    const traces: TraceSearchResult[] = [];
    const results = data.traces || data.results || [];
    if (isArray(results)) {
      for (const t of results) {
        const rawTraceId = t.traceID || t.traceId || '';
        const traceId = /^[0-9a-fA-F]{1,32}$/.test(rawTraceId)
          ? rawTraceId.toLowerCase().padStart(32, '0')
          : rawTraceId;
        traces.push({
          traceId,
          rootServiceName: t.rootServiceName,
          rootTraceName: t.rootTraceName,
          startTimeUnixNano: isFilled(t.startTimeUnixNano)
            ? String(t.startTimeUnixNano)
            : undefined,
          durationMs: isNumber(t.durationMs) ? round(t.durationMs) : undefined
        });
      }
    }

    return { rawBytes, traces };
  }
}
