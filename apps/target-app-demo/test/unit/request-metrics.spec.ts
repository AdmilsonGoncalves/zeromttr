import { describe, expect, it } from 'vitest';
import { RequestMetricsTracker } from '../../src/telemetry/request-metrics.js';

describe('RequestMetricsTracker', () => {
  it('should_return_zero_metrics_when_window_is_empty', () => {
    const tracker = new RequestMetricsTracker(10_000);
    expect(tracker.getSnapshot(100_000)).toEqual({
      requestsPerSecond: 0,
      errorRate5xxPercent: 0,
      p95LatencyMs: 0
    });
  });

  it('should_compute_rps_5xx_rate_and_p95_latency_within_sliding_window', () => {
    const tracker = new RequestMetricsTracker(10_000);
    const now = 50_000;

    // 10 samples within 10s window => 1.0 req/s; 2 are 5xx => 20.0%
    for (let i = 1; i <= 8; i++) {
      tracker.record(i * 10, 200, now - 1000);
    }
    tracker.record(4600, 503, now - 500);
    tracker.record(4700, 500, now - 200);

    // Expired sample outside window should be pruned
    tracker.record(9999, 500, now - 15_000);

    const snapshot = tracker.getSnapshot(now);
    expect(snapshot.requestsPerSecond).toBe(1);
    expect(snapshot.errorRate5xxPercent).toBe(20);
    expect(snapshot.p95LatencyMs).toBe(4700);
  });
});
