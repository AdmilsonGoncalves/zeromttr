import { describe, it, expect } from 'vitest';
import { calculateFinOps, FinOpsCalculator } from '../../src/domain/finops.js';

describe('FinOpsCalculator domain', () => {
  it('should calculate reduction metrics correctly when payload is compacted', () => {
    const rawBytes = 10000;
    const compactedBytes = 2000;
    const metrics = calculateFinOps(rawBytes, compactedBytes);

    expect(metrics.raw_bytes_fetched).toBe(10000);
    expect(metrics.compacted_bytes_sent_to_llm).toBe(2000);
    expect(metrics.payload_reduction_percent).toBe(80);
    expect(metrics.estimated_tokens_saved).toBe(2000); // (10000 - 2000) / 4
  });

  it('should handle zero raw bytes without division by zero', () => {
    const metrics = FinOpsCalculator.calculate(0, 0);
    expect(metrics.payload_reduction_percent).toBe(0);
    expect(metrics.estimated_tokens_saved).toBe(0);
  });

  it('should handle compacted bytes larger than raw bytes gracefully', () => {
    const metrics = calculateFinOps(500, 1000);
    expect(metrics.payload_reduction_percent).toBe(0);
    expect(metrics.estimated_tokens_saved).toBe(0);
  });

  it('should round reduction percentage to two decimal places', () => {
    const metrics = calculateFinOps(300, 100);
    expect(metrics.payload_reduction_percent).toBe(66.67);
    expect(metrics.estimated_tokens_saved).toBe(50);
  });
});
