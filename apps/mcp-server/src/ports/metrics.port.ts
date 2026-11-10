import type { RawPromSeries } from '../domain/summarize-series.js';

export interface PromqlQueryInput {
  query: string;
  start: string;
  end: string;
  step?: string;
}

export interface MetricsQueryResult {
  rawBytes: number;
  series: RawPromSeries[];
}

export interface MetricsPort {
  queryRange(input: PromqlQueryInput): Promise<MetricsQueryResult>;
}
