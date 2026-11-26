import { clamp, isNumber, percentage, round } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';

export interface RequestMetricSample {
  timestamp: number;
  durationMs: number;
  statusCode: number;
}

export interface RequestMetricsSnapshot {
  requestsPerSecond: number;
  errorRate5xxPercent: number;
  p95LatencyMs: number;
}

const DEFAULT_WINDOW_MS = 10_000;

/**
 * In-process sliding-window tracker for HTTP request throughput, 5xx error rate, and p95 latency.
 */
export class RequestMetricsTracker {
  private samples: RequestMetricSample[] = [];

  public constructor(private readonly windowMs: number = DEFAULT_WINDOW_MS) {}

  /**
   * Records a completed HTTP request sample and prunes expired samples outside the window.
   */
  public record(durationMs: number, statusCode: number, now: number = Date.now()): void {
    const safeDuration = isNumber(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.samples.push({
      timestamp: now,
      durationMs: safeDuration,
      statusCode
    });
    this.prune(now);
  }

  /**
   * Returns aggregated throughput, 5xx error percentage, and p95 latency for the active window.
   */
  public getSnapshot(now: number = Date.now()): RequestMetricsSnapshot {
    this.prune(now);

    if (this.samples.length === 0) {
      return {
        requestsPerSecond: 0,
        errorRate5xxPercent: 0,
        p95LatencyMs: 0
      };
    }

    const total = this.samples.length;
    const windowSeconds = this.windowMs / 1000;
    const requestsPerSecond = round(total / windowSeconds, 1);

    let error5xxCount = 0;
    const durations: number[] = [];
    for (const sample of this.samples) {
      if (sample.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        error5xxCount += 1;
      }
      durations.push(sample.durationMs);
    }

    const errorRate5xxPercent = percentage(error5xxCount, total, 1);
    durations.sort((a, b) => a - b);
    const p95Index = clamp(Math.ceil(durations.length * 0.95) - 1, 0, durations.length - 1);
    const p95LatencyMs = round(durations[p95Index] ?? 0);

    return {
      requestsPerSecond,
      errorRate5xxPercent,
      p95LatencyMs
    };
  }

  /**
   * Clears all recorded samples (used in test isolation).
   */
  public reset(): void {
    this.samples = [];
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    if (this.samples.length > 0) {
      this.samples = this.samples.filter((sample) => sample.timestamp >= cutoff);
    }
  }
}

export const requestMetrics = new RequestMetricsTracker();
