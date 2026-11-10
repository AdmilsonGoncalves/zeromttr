export interface FinOpsMetrics {
  raw_bytes_fetched: number;
  compacted_bytes_sent_to_llm: number;
  payload_reduction_percent: number;
  estimated_tokens_saved: number;
}

export function calculateFinOps(rawBytes: number, compactedBytes: number): FinOpsMetrics {
  const safeRaw = Math.max(0, rawBytes);
  const safeCompacted = Math.max(0, compactedBytes);
  const reductionBytes = Math.max(0, safeRaw - safeCompacted);
  const payload_reduction_percent =
    safeRaw > 0 ? Number(((reductionBytes / safeRaw) * 100).toFixed(2)) : 0;
  // Standard LLM FinOps heuristic: ~4 bytes per token
  const estimated_tokens_saved = Math.round(reductionBytes / 4);

  return {
    raw_bytes_fetched: safeRaw,
    compacted_bytes_sent_to_llm: safeCompacted,
    payload_reduction_percent,
    estimated_tokens_saved
  };
}

export class FinOpsCalculator {
  static calculate(rawBytes: number, compactedBytes: number): FinOpsMetrics {
    return calculateFinOps(rawBytes, compactedBytes);
  }
}
