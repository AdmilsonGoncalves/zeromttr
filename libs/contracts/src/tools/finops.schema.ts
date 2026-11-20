import { z } from 'zod';

/**
 * FinOps payload-pruning telemetry attached to MCP read tools.
 */
export const FinOpsMetricsSchema = z.object({
  rawBytesFetched: z.number().int().nonnegative(),
  compactedBytesSentToLlm: z.number().int().nonnegative(),
  payloadReductionPercent: z.number().min(0).max(100),
  estimatedTokensSaved: z.number().int().nonnegative()
});

export type FinOpsMetrics = z.infer<typeof FinOpsMetricsSchema>;
