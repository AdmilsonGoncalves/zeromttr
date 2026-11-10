import type { MetricsPort, PromqlQueryInput } from '../ports/index.js';
import {
  SeriesSummarizer,
  type SeriesSummary,
  FinOpsCalculator,
  type FinOpsMetrics
} from '../domain/index.js';
import { validateTimeRange } from './validate-time-range.js';

export interface ExecutePromqlRangeOutput {
  query: string;
  series_count: number;
  series: SeriesSummary[];
  finops: FinOpsMetrics;
}

export class ExecutePromqlRange {
  constructor(private readonly metricsPort: MetricsPort) {}

  async execute(input: PromqlQueryInput): Promise<ExecutePromqlRangeOutput> {
    const { startIso, endIso } = validateTimeRange(input.start, input.end);

    const result = await this.metricsPort.queryRange({
      ...input,
      start: startIso,
      end: endIso
    });
    const series = SeriesSummarizer.summarize(result.series, 5, 10);

    const compactedBytes = Buffer.byteLength(JSON.stringify(series), 'utf-8');
    const finops = FinOpsCalculator.calculate(result.rawBytes, compactedBytes);

    return {
      query: input.query,
      series_count: series.length,
      series,
      finops
    };
  }
}
