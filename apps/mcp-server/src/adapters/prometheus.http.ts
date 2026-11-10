import type { MetricsPort, PromqlQueryInput, MetricsQueryResult } from '../ports/metrics.port.js';
import type { RawPromSeries } from '../domain/summarize-series.js';
import { buildUrl } from '@zeromttr/utils/http';

export interface PrometheusAdapterConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class PrometheusHttpAdapter implements MetricsPort {
  constructor(private readonly config: PrometheusAdapterConfig) {}

  async queryRange(input: PromqlQueryInput): Promise<MetricsQueryResult> {
    const windowSec = Math.max(1, (Date.parse(input.end) - Date.parse(input.start)) / 1000);
    const defaultStep = `${Math.max(15, Math.ceil(windowSec / 250))}s`;

    const url = buildUrl(this.config.baseUrl, '/api/v1/query_range', {
      query: input.query,
      start: input.start,
      end: input.end,
      step: input.step || defaultStep
    });
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.config.timeoutMs || 10_000)
    });

    if (!response.ok) {
      throw new Error(`Prometheus query failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    let data: {
      status?: string;
      data?: { result?: Array<{ metric: Record<string, string>; values: [number, string][] }> };
    };
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse Prometheus JSON response: ${(err as Error).message}`);
    }

    if (data.status !== 'success' || !data.data || !Array.isArray(data.data.result)) {
      return { rawBytes, series: [] };
    }

    const series: RawPromSeries[] = data.data.result.map((item) => ({
      metric: item.metric || {},
      values: Array.isArray(item.values) ? item.values : []
    }));

    return { rawBytes, series };
  }
}
