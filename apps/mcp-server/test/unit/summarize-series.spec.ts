import { describe, it, expect } from 'vitest';
import {
  summarizeSeries,
  SeriesSummarizer,
  type RawPromSeries
} from '../../src/domain/summarize-series.js';

describe('SeriesSummarizer domain', () => {
  const sampleSeries: RawPromSeries[] = [
    {
      metric: { __name__: 'http_requests_total', status: '500' },
      values: [
        [1700000000, '10'],
        [1700000015, '20'],
        [1700000030, '30'],
        [1700000045, '40'],
        [1700000060, '100']
      ],
      exemplars: [
        {
          timestamp: 1700000060,
          value: '100',
          labels: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736' }
        }
      ]
    }
  ];

  it('should compute statistical metrics accurately', () => {
    const summary = SeriesSummarizer.summarize(sampleSeries);
    expect(summary).toHaveLength(1);
    const s = summary[0];
    expect(s.metric).toEqual({ __name__: 'http_requests_total', status: '500' });
    expect(s.points_count).toBe(5);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
    expect(s.avg).toBe(40);
    expect(s.latest).toBe(100);
    expect(s.p95).toBe(100);
    expect(s.exemplars).toHaveLength(1);
    expect(s.exemplars[0].labels.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('should limit series count to at most maxSeries (default 5)', () => {
    const multiSeries: RawPromSeries[] = Array.from({ length: 12 }, (_, i) => ({
      metric: { job: `job-${i}` },
      values: [[1700000000, String(i * 10)]]
    }));

    const summary = summarizeSeries(multiSeries, 5);
    expect(summary).toHaveLength(5);
  });

  it('should limit exemplars per series to at most maxExemplars (default 10)', () => {
    const seriesWithExemplars: RawPromSeries = {
      metric: { job: 'api' },
      values: [[1700000000, '5']],
      exemplars: Array.from({ length: 25 }, (_, i) => ({
        timestamp: 1700000000 + i,
        value: String(i),
        labels: { trace_id: `trace-${i}` }
      }))
    };

    const summary = summarizeSeries([seriesWithExemplars], 5, 10);
    expect(summary[0].exemplars).toHaveLength(10);
  });

  it('should handle series with empty values gracefully', () => {
    const emptySeries: RawPromSeries = {
      metric: { job: 'empty' },
      values: []
    };

    const summary = summarizeSeries([emptySeries]);
    expect(summary).toHaveLength(1);
    expect(summary[0].points_count).toBe(0);
    expect(summary[0].min).toBe(0);
    expect(summary[0].max).toBe(0);
    expect(summary[0].avg).toBe(0);
    expect(summary[0].latest).toBe(0);
  });
});
