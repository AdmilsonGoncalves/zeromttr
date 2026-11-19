import { z } from 'zod';
import { FinOpsMetricsSchema } from './finops.schema.js';

const TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;

// 1. execute_promql_range
export const ExecutePromqlRangeInputSchema = z.object({
  query: z.string().min(1),
  start: z.string().datetime().or(z.number()),
  end: z.string().datetime().or(z.number()),
  step: z.string().optional().default('15s')
});

export const SummarizedPromqlSeriesSchema = z.object({
  metric: z.record(z.string()),
  p50: z.number(),
  p95: z.number(),
  max: z.number(),
  sampleCount: z.number()
});

export const ExecutePromqlRangeOutputSchema = z.object({
  seriesCount: z.number().int().max(5),
  summarizedSeries: z.array(SummarizedPromqlSeriesSchema),
  exemplarTraceId: z.string().regex(TRACE_ID_REGEX).optional(),
  finops: FinOpsMetricsSchema
});

// 2. analyze_otel_trace
export const AnalyzeOtelTraceInputSchema = z.object({
  traceId: z.string().regex(TRACE_ID_REGEX)
});

export const CriticalTraceSpanSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  serviceName: z.string(),
  operationName: z.string(),
  durationMs: z.number(),
  hasError: z.boolean(),
  errorMessage: z.string().optional()
});

export const AnalyzeOtelTraceOutputSchema = z.object({
  traceId: z.string(),
  rootServiceName: z.string(),
  totalDurationMs: z.number(),
  criticalSpans: z.array(CriticalTraceSpanSchema).max(5),
  servicesInvolved: z.array(z.string())
});

// 3. search_traces_by_traceql
export const SearchTracesByTraceqlInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(5)
});

export const TraceqlSearchHitSchema = z.object({
  traceId: z.string(),
  durationMs: z.number(),
  errorCount: z.number(),
  rootServiceName: z.string()
});

export const SearchTracesByTraceqlOutputSchema = z.object({
  traces: z.array(TraceqlSearchHitSchema)
});

// 4. query_loki_logs
export const QueryLokiLogsInputSchema = z.object({
  logql: z.string().min(1),
  start: z.string().datetime().or(z.number()),
  end: z.string().datetime().or(z.number()),
  limit: z.number().int().min(1).max(100).optional().default(50)
});

export const LokiLogEntrySchema = z.object({
  timestamp: z.string(),
  stream: z.record(z.string()),
  line: z.string().max(500)
});

export const QueryLokiLogsOutputSchema = z.object({
  linesReturned: z.number().int().max(100),
  logs: z.array(LokiLogEntrySchema),
  finops: FinOpsMetricsSchema
});

// 5. inspect_git_deploy_diff
export const InspectGitDeployDiffInputSchema = z.object({
  base_ref: z.string().min(1),
  head_ref: z.string().min(1),
  service_path: z.string().optional().default('apps/target-app-demo'),
  suspect_keyword: z.string().optional()
});

export const InspectGitDeployDiffOutputSchema = z.object({
  suspectCommitSha: z.string(),
  authorLogin: z.string(),
  commitMessage: z.string(),
  suspectFilePath: z.string(),
  currentBlobSha: z.string(),
  truncatedPatch: z.string().max(1500),
  finops: FinOpsMetricsSchema
});

// 6. create_remediation_pr
export const CreateRemediationPrInputSchema = z.object({
  incident_id: z.string().min(1),
  file_path: z.string().min(1),
  patched_content: z.string().min(1),
  blob_sha: z.string().optional(),
  title: z.string().min(1),
  rca_markdown: z.string(),
  reasoning_source: z.enum(['llm', 'fallback'])
});

export const CreateRemediationPrOutputSchema = z.object({
  branchName: z.string(),
  branchUrl: z.string().url(),
  pullRequestUrl: z.string().url(),
  commitSha: z.string()
});

// 7. send_post_mortem_resend
export const SendPostMortemResendInputSchema = z.object({
  incidentId: z.string().min(1),
  recipientEmail: z.string().email(),
  htmlBody: z.string().min(1)
});

export const SendPostMortemResendOutputSchema = z.object({
  emailId: z.string(),
  sentAt: z.string()
});

// 8. annotate_grafana_incident
export const AnnotateGrafanaIncidentInputSchema = z.object({
  time: z.number().int(),
  text: z.string().min(1),
  tags: z.array(z.string()),
  pullRequestUrl: z.string().url().optional()
});

export const AnnotateGrafanaIncidentOutputSchema = z.object({
  annotationId: z.number().int(),
  success: z.boolean()
});

export type ExecutePromqlRangeInput = z.infer<typeof ExecutePromqlRangeInputSchema>;
export type ExecutePromqlRangeOutput = z.infer<typeof ExecutePromqlRangeOutputSchema>;
export type AnalyzeOtelTraceInput = z.infer<typeof AnalyzeOtelTraceInputSchema>;
export type AnalyzeOtelTraceOutput = z.infer<typeof AnalyzeOtelTraceOutputSchema>;
export type SearchTracesByTraceqlInput = z.infer<typeof SearchTracesByTraceqlInputSchema>;
export type SearchTracesByTraceqlOutput = z.infer<typeof SearchTracesByTraceqlOutputSchema>;
export type QueryLokiLogsInput = z.infer<typeof QueryLokiLogsInputSchema>;
export type QueryLokiLogsOutput = z.infer<typeof QueryLokiLogsOutputSchema>;
export type InspectGitDeployDiffInput = z.infer<typeof InspectGitDeployDiffInputSchema>;
export type InspectGitDeployDiffOutput = z.infer<typeof InspectGitDeployDiffOutputSchema>;
export type CreateRemediationPrInput = z.infer<typeof CreateRemediationPrInputSchema>;
export type CreateRemediationPrOutput = z.infer<typeof CreateRemediationPrOutputSchema>;
export type SendPostMortemResendInput = z.infer<typeof SendPostMortemResendInputSchema>;
export type SendPostMortemResendOutput = z.infer<typeof SendPostMortemResendOutputSchema>;
export type AnnotateGrafanaIncidentInput = z.infer<typeof AnnotateGrafanaIncidentInputSchema>;
export type AnnotateGrafanaIncidentOutput = z.infer<typeof AnnotateGrafanaIncidentOutputSchema>;
