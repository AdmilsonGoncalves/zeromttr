import { percentage, round } from '@zeromttr/utils';

export interface EvidenceCoverageInputs {
  hasPromqlAnomaly?: boolean;
  hasMetricExemplar?: boolean;
  hasTempoErrorSpan?: boolean;
  hasLokiLogAndGitDiff?: boolean;
}

export interface EvidenceCoverageBreakdown {
  promql: number;
  exemplar: number;
  tempoSpan: number;
  lokiAndDiff: number;
}

export interface EvidenceCoverageResult {
  score: number;
  signalsCollected: number;
  signalsTotal: number;
  signals: string[];
  breakdown: EvidenceCoverageBreakdown;
}

export function calculateEvidenceCoverage(inputs: EvidenceCoverageInputs): EvidenceCoverageResult {
  const signals: string[] = [];

  const breakdown: EvidenceCoverageBreakdown = {
    promql: 0,
    exemplar: 0,
    tempoSpan: 0,
    lokiAndDiff: 0
  };

  if (inputs.hasPromqlAnomaly) {
    signals.push('promql_anomaly');
    breakdown.promql = 25;
  }

  if (inputs.hasMetricExemplar) {
    signals.push('metric_exemplar');
    breakdown.exemplar = 25;
  }

  if (inputs.hasTempoErrorSpan) {
    signals.push('tempo_error_span');
    breakdown.tempoSpan = 25;
  }

  if (inputs.hasLokiLogAndGitDiff) {
    signals.push('loki_log_diff');
    breakdown.lokiAndDiff = 25;
  }

  const score = round(percentage(signals.length, 4, 0));

  return {
    score,
    signalsCollected: signals.length,
    signalsTotal: 4,
    signals,
    breakdown
  };
}
