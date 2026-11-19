import { z } from 'zod';

/**
 * Reasoning provenance recorded on RCA reports and remediation PRs.
 */
export const ReasoningProvider = {
  LLM: 'llm',
  FALLBACK: 'fallback'
} as const;
export type ReasoningProvider = (typeof ReasoningProvider)[keyof typeof ReasoningProvider];

export const ReasoningSourceSchema = z.nativeEnum(ReasoningProvider);
export type ReasoningSource = z.infer<typeof ReasoningSourceSchema>;

/**
 * Evidence bundle passed to ReasoningPort after PiiPromptGuard validation.
 */
export const CollectedEvidenceSchema = z.object({
  incidentId: z.string().min(1),
  service: z.string().min(1),
  alertName: z.string().min(1),
  promqlSummary: z.object({
    metric: z.string().min(1),
    p95LatencyMs: z.number().optional(),
    dbPoolWaiting: z.number().optional()
  }),
  traceAnalysis: z.object({
    traceId: z.string(),
    criticalOperation: z.string(),
    durationMs: z.number(),
    errorMessage: z.string().optional(),
    servicesInvolved: z.array(z.string())
  }),
  logSample: z.string(),
  gitDiff: z.object({
    baseRef: z.string(),
    headRef: z.string(),
    suspectCommit: z.string(),
    authorLogin: z.string(),
    suspectFilePath: z.string(),
    patch: z.string()
  }),
  signals: z
    .object({
      hasPromqlAnomaly: z.boolean().optional(),
      hasMetricExemplar: z.boolean().optional(),
      hasTempoErrorSpan: z.boolean().optional(),
      hasLokiLogAndGitDiff: z.boolean().optional()
    })
    .optional()
});

export type CollectedEvidence = z.infer<typeof CollectedEvidenceSchema>;

/**
/ * Structured output schema required from LLM synthesis (6 canonical fields).
 */
export const RcaAndPatchSynthesisSchema = z
  .object({
    summary: z.string().min(1).describe('Resumo executivo do incidente em 1 parágrafo'),
    rootCause: z
      .string()
      .min(1)
      .describe('Explicação técnica detalhada da causa raiz encontrada no código'),
    evidenceRefs: z
      .array(z.string())
      .describe('Lista de referências de evidências (ex: trace_id, métrica, commit)'),
    suspectFilePath: z.string().min(1).describe('Caminho do arquivo remediado'),
    patchedContent: z
      .string()
      .min(1)
      .describe('Conteúdo integral do arquivo corrigido pronto para commit'),
    explanation: z
      .string()
      .min(1)
      .describe('Explicação da alteração realizada no patch e como ela resolve o incidente')
  })
  .strict();

export type RcaAndPatchSynthesis = z.infer<typeof RcaAndPatchSynthesisSchema> & {
  reasoningSource?: ReasoningSource;
};
