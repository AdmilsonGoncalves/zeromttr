export interface PromExemplar {
  timestamp: number;
  value: string;
  labels: Record<string, string>;
}

export interface RawPromSeries {
  metric: Record<string, string>;
  values: [number, string][];
  exemplars?: PromExemplar[];
}

export interface SeriesSummary {
  metric: Record<string, string>;
  points_count: number;
  min: number;
  max: number;
  avg: number;
  latest: number;
  p95: number;
  exemplars: PromExemplar[];
}

function calculatePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(sortedValues.length - 1, index));
  return sortedValues[safeIndex];
}

export function summarizeSeries(
  series: RawPromSeries[],
  maxSeries = 5,
  maxExemplars = 10
): SeriesSummary[] {
  const boundedSeries = series.slice(0, maxSeries);

  return boundedSeries.map((s) => {
    const rawValues = s.values.map(([, val]) => Number(val)).filter((v) => !Number.isNaN(v));

    if (rawValues.length === 0) {
      return {
        metric: s.metric,
        points_count: 0,
        min: 0,
        max: 0,
        avg: 0,
        latest: 0,
        p95: 0,
        exemplars: (s.exemplars || []).slice(0, maxExemplars)
      };
    }

    const min = Math.min(...rawValues);
    const max = Math.max(...rawValues);
    const sum = rawValues.reduce((acc, curr) => acc + curr, 0);
    const avg = Number((sum / rawValues.length).toFixed(2));
    const latest = rawValues[rawValues.length - 1];

    const sorted = [...rawValues].sort((a, b) => a - b);
    const p95 = calculatePercentile(sorted, 95);

    const exemplars = (s.exemplars || []).slice(0, maxExemplars);

    return {
      metric: s.metric,
      points_count: rawValues.length,
      min,
      max,
      avg,
      latest,
      p95,
      exemplars
    };
  });
}

export class SeriesSummarizer {
  static summarize(series: RawPromSeries[], maxSeries = 5, maxExemplars = 10): SeriesSummary[] {
    return summarizeSeries(series, maxSeries, maxExemplars);
  }
}
