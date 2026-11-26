import type { MetricsPort, PromqlQueryInput, MetricsQueryResult } from '../ports/metrics.port.js';
import type { RawPromSeries } from '../domain/summarize-series.js';
import { diffInSeconds, isArray, safeJsonParse } from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, buildUrl, isHttpSuccess } from '@zeromttr/utils/http';

export interface PrometheusAdapterConfig {
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * Prometheus HTTP adapter executing bounded PromQL range queries with adaptive step sizing.
 */
export class PrometheusHttpAdapter implements MetricsPort {
  constructor(private readonly config: PrometheusAdapterConfig) {}

  /**
   * Executes a PromQL range query against Prometheus and returns parsed metric series with raw byte size.
   */
  async queryRange(input: PromqlQueryInput): Promise<MetricsQueryResult> {
    const windowSec = Math.max(1, diffInSeconds(input.start, input.end));
    const defaultStep = `${Math.max(15, Math.ceil(windowSec / 250))}s`;

    const url = buildUrl(this.config.baseUrl, '/api/v1/query_range', {
      query: input.query,
      start: input.start,
      end: input.end,
      step: input.step || defaultStep
    });
    const response = await fetch(url, {
      headers: { [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON },
      signal: AbortSignal.timeout(this.config.timeoutMs || 10_000)
    });

    if (!isHttpSuccess(response.status)) {
      throw new Error(`Prometheus query failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    const data = safeJsonParse<{
      status?: string;
      data?: { result?: Array<{ metric: Record<string, string>; values: [number, string][] }> };
    }>(text);
    if (!data) {
      throw new Error('Failed to parse Prometheus JSON response');
    }

    if (data.status !== 'success' || !data.data || !isArray(data.data.result)) {
      return { rawBytes, series: [] };
    }

    const series: RawPromSeries[] = data.data.result.map((item) => ({
      metric: item.metric || {},
      values: isArray(item.values) ? item.values : []
    }));

    return { rawBytes, series };
  }
}
