import { describe, it, expect } from 'vitest';
import { calculateEvidenceCoverage } from '../../../src/domain/index.js';

describe('EvidenceCoverage Calculator', () => {
  it('should return 100% (4/4 signals) when all four signals are verified', () => {
    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly: true,
      hasMetricExemplar: true,
      hasTempoErrorSpan: true,
      hasLokiLogAndGitDiff: true
    });

    expect(coverage.score).toBe(100);
    expect(coverage.signalsCollected).toBe(4);
    expect(coverage.signalsTotal).toBe(4);
    expect(coverage.signals).toEqual([
      'promql_anomaly',
      'metric_exemplar',
      'tempo_error_span',
      'loki_log_diff'
    ]);
    expect(coverage.breakdown).toEqual({
      promql: 25,
      exemplar: 25,
      tempoSpan: 25,
      lokiAndDiff: 25
    });
  });

  it('should return 75% (3/4 signals) when one signal is missing', () => {
    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly: true,
      hasMetricExemplar: true,
      hasTempoErrorSpan: true,
      hasLokiLogAndGitDiff: false
    });

    expect(coverage.score).toBe(75);
    expect(coverage.signalsCollected).toBe(3);
    expect(coverage.breakdown.lokiAndDiff).toBe(0);
  });

  it('should return 50% (2/4 signals) when two signals are missing', () => {
    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly: true,
      hasMetricExemplar: true,
      hasTempoErrorSpan: false,
      hasLokiLogAndGitDiff: false
    });

    expect(coverage.score).toBe(50);
    expect(coverage.signalsCollected).toBe(2);
    expect(coverage.signals).toEqual(['promql_anomaly', 'metric_exemplar']);
  });

  it('should return 25% (1/4 signals) when only one signal is present', () => {
    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly: true,
      hasMetricExemplar: false,
      hasTempoErrorSpan: false,
      hasLokiLogAndGitDiff: false
    });

    expect(coverage.score).toBe(25);
    expect(coverage.signalsCollected).toBe(1);
    expect(coverage.signals).toEqual(['promql_anomaly']);
  });

  it('should return 0% (0/4 signals) when no signals are collected', () => {
    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly: false,
      hasMetricExemplar: false,
      hasTempoErrorSpan: false,
      hasLokiLogAndGitDiff: false
    });

    expect(coverage.score).toBe(0);
    expect(coverage.signalsCollected).toBe(0);
    expect(coverage.signals).toEqual([]);
    expect(coverage.breakdown).toEqual({
      promql: 0,
      exemplar: 0,
      tempoSpan: 0,
      lokiAndDiff: 0
    });
  });
});
