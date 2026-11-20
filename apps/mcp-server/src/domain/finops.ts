import { FinOpsMetricsSchema } from '@zeromttr/contracts';
import { percentage, round } from '@zeromttr/utils';

export interface FinOpsMetrics {
  raw_bytes_fetched: number;
  compacted_bytes_sent_to_llm: number;
  payload_reduction_percent: number;
  estimated_tokens_saved: number;
}

/**
 * Computes byte and estimated LLM token savings between raw and compacted tool payloads.
 */
export function calculateFinOps(rawBytes: number, compactedBytes: number): FinOpsMetrics {
  const safeRaw = Math.max(0, rawBytes);
  const safeCompacted = Math.max(0, compactedBytes);
  const reductionBytes = Math.max(0, safeRaw - safeCompacted);
  const payload_reduction_percent = percentage(reductionBytes, safeRaw, 2);
  // Standard LLM FinOps heuristic: ~4 bytes per token
  const estimated_tokens_saved = round(reductionBytes / 4);

  const validated = FinOpsMetricsSchema.parse({
    rawBytesFetched: Math.round(safeRaw),
    compactedBytesSentToLlm: Math.round(safeCompacted),
    payloadReductionPercent: payload_reduction_percent,
    estimatedTokensSaved: estimated_tokens_saved
  });

  return {
    raw_bytes_fetched: validated.rawBytesFetched,
    compacted_bytes_sent_to_llm: validated.compactedBytesSentToLlm,
    payload_reduction_percent: validated.payloadReductionPercent,
    estimated_tokens_saved: validated.estimatedTokensSaved
  };
}

export class FinOpsCalculator {
  /**
   * Calculates validated FinOps payload reduction metrics.
   */
  static calculate(rawBytes: number, compactedBytes: number): FinOpsMetrics {
    return calculateFinOps(rawBytes, compactedBytes);
  }
}
