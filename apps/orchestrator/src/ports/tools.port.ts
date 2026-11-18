import type { ReasoningSource } from '../domain/index.js';

export interface FinOpsData {
  rawBytesFetched: number;
  compactedBytesSentToLlm: number;
  payloadReductionPercent: number;
  estimatedTokensSaved: number;
}

export interface PromqlRangeInput {
  query: string;
  start: string;
  end: string;
  step?: string;
}

export interface PromqlRangeOutput {
  seriesCount: number;
  summarizedSeries: Array<{
    metric: Record<string, string>;
    p50?: number;
    p95?: number;
    max?: number;
    sampleCount?: number;
  }>;
  exemplarTraceId?: string;
  finops: FinOpsData;
}

export interface LokiQueryInput {
  logql: string;
  start: string;
  end: string;
  limit?: number;
}

export interface LokiQueryOutput {
  linesReturned: number;
  logs: Array<{
    timestamp?: string;
    stream?: Record<string, string>;
    line: string;
  }>;
  finops: FinOpsData;
}

export interface TraceAnalysisInput {
  trace_id: string;
}

export interface TraceSpanItem {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
  errorMessage?: string;
}

export interface TraceAnalysisOutput {
  traceId: string;
  rootServiceName?: string;
  totalDurationMs?: number;
  criticalSpans?: TraceSpanItem[];
  servicesInvolved: string[];
}

export interface TraceQlInput {
  query: string;
  limit?: number;
}

export interface TraceQlOutput {
  traces: Array<{
    traceId: string;
    durationMs: number;
    errorCount: number;
    rootServiceName: string;
  }>;
}

export interface GitDeployDiffInput {
  base_ref: string;
  head_ref: string;
  service_path?: string;
  suspect_keyword?: string;
}

export interface GitDeployDiffOutput {
  suspectCommitSha: string;
  authorLogin: string;
  commitMessage: string;
  suspectFilePath: string;
  currentBlobSha: string;
  truncatedPatch: string;
  finops: FinOpsData;
}

export interface CreateRemediationPrInput {
  incident_id: string;
  file_path: string;
  patched_content: string;
  blob_sha?: string;
  title: string;
  rca_markdown: string;
  reasoning_source: ReasoningSource;
}

export interface CreateRemediationPrOutput {
  branchName: string;
  branchUrl: string;
  pullRequestUrl: string;
  commitSha: string;
}

export interface SendPostMortemInput {
  incident_id: string;
  recipient_email?: string;
  title: string;
  rca_summary: string;
  evidence_coverage: string;
  reasoning_source: ReasoningSource;
  blast_radius: string[];
  regression_commit: string;
  pull_request_url: string;
  approve_url: string;
  reject_url: string;
  leaked_patterns_detected?: number;
}

export interface SendPostMortemOutput {
  emailId: string;
  sentAt?: string;
}

export interface AnnotateGrafanaInput {
  time?: number;
  text: string;
  tags?: string[];
  pull_request_url?: string;
}

export interface AnnotateGrafanaOutput {
  annotationId?: number;
  success: boolean;
}

export interface ToolsPort {
  executePromqlRange(input: PromqlRangeInput): Promise<PromqlRangeOutput>;
  queryLokiLogs(input: LokiQueryInput): Promise<LokiQueryOutput>;
  analyzeOtelTrace(input: TraceAnalysisInput): Promise<TraceAnalysisOutput>;
  searchTracesByTraceQL(input: TraceQlInput): Promise<TraceQlOutput>;
  inspectGitDeployDiff(input: GitDeployDiffInput): Promise<GitDeployDiffOutput>;
  createRemediationPr(input: CreateRemediationPrInput): Promise<CreateRemediationPrOutput>;
  sendPostMortemResend(input: SendPostMortemInput): Promise<SendPostMortemOutput>;
  annotateGrafanaIncident(input: AnnotateGrafanaInput): Promise<AnnotateGrafanaOutput>;
}
