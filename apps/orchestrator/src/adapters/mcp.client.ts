import { isNonEmptyString, safeJsonParse } from '@zeromttr/utils';
import { buildUrl, isHttpSuccess, sanitizeHeaderValue } from '@zeromttr/utils/http';
import type {
  ToolsPort,
  FinOpsData,
  PromqlRangeInput,
  PromqlRangeOutput,
  LokiQueryInput,
  LokiQueryOutput,
  TraceAnalysisInput,
  TraceAnalysisOutput,
  TraceSpanItem,
  TraceQlInput,
  TraceQlOutput,
  GitDeployDiffInput,
  GitDeployDiffOutput,
  CreateRemediationPrInput,
  CreateRemediationPrOutput,
  SendPostMortemInput,
  SendPostMortemOutput,
  AnnotateGrafanaInput,
  AnnotateGrafanaOutput
} from '../ports/index.js';

export class McpClientAdapter implements ToolsPort {
  private readonly baseUrl: string;
  private readonly authToken: string;

  public constructor(baseUrl?: string, authToken?: string) {
    this.baseUrl = buildUrl(baseUrl || process.env.MCP_SERVER_URL || 'http://localhost:8000/mcp');
    this.authToken = sanitizeHeaderValue(
      authToken || process.env.MCP_AUTH_TOKEN || 'test-mcp-token'
    );
  }

  private mapFinOps(finops: unknown): FinOpsData {
    if (!finops || typeof finops !== 'object') {
      return {
        rawBytesFetched: 0,
        compactedBytesSentToLlm: 0,
        payloadReductionPercent: 0,
        estimatedTokensSaved: 0
      };
    }
    const f = finops as Record<string, unknown>;
    return {
      rawBytesFetched: Number(f.rawBytesFetched ?? f.raw_bytes_fetched ?? 0),
      compactedBytesSentToLlm: Number(
        f.compactedBytesSentToLlm ?? f.compacted_bytes_sent_to_llm ?? 0
      ),
      payloadReductionPercent: Number(
        f.payloadReductionPercent ?? f.payload_reduction_percent ?? 0
      ),
      estimatedTokensSaved: Number(f.estimatedTokensSaved ?? f.estimated_tokens_saved ?? 0)
    };
  }

  private async callTool<T>(name: string, args: unknown): Promise<T> {
    const timeoutMs = Number(process.env.MCP_TIMEOUT_MS) || 30_000;
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name,
          arguments: args
        }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!isHttpSuccess(response.status) || !response.ok) {
      const text = await response.text();
      throw new Error(
        `MCP tool '${name}' HTTP request failed with status ${response.status}: ${text}`
      );
    }

    const payload = (await response.json()) as {
      result?: {
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      error?: { code: number; message: string };
    };

    if (payload.error) {
      throw new Error(`MCP JSON-RPC error for tool '${name}': ${payload.error.message}`);
    }

    if (payload.result?.isError) {
      const errText = payload.result.content?.[0]?.text || 'Tool execution reported error';
      throw new Error(`MCP tool '${name}' failed: ${errText}`);
    }

    const outputText = payload.result?.content?.[0]?.text;
    if (!isNonEmptyString(outputText)) {
      throw new Error(`MCP tool '${name}' returned empty or missing output text`);
    }

    const parsed = safeJsonParse<T>(outputText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`MCP tool '${name}' response could not be parsed as a valid JSON object`);
    }
    return parsed;
  }

  public async executePromqlRange(input: PromqlRangeInput): Promise<PromqlRangeOutput> {
    const raw = await this.callTool<Record<string, unknown>>('execute_promql_range', input);
    const rawSeries = Array.isArray(raw.series)
      ? raw.series
      : (raw.summarizedSeries as Array<Record<string, unknown>>) || [];
    const summarizedSeries = rawSeries.map((s: Record<string, unknown>) => ({
      metric: (s.metric as Record<string, string>) || {},
      p50: typeof s.p50 === 'number' ? s.p50 : typeof s.avg === 'number' ? s.avg : undefined,
      p95: typeof s.p95 === 'number' ? s.p95 : undefined,
      max: typeof s.max === 'number' ? s.max : undefined,
      sampleCount:
        typeof s.sampleCount === 'number'
          ? s.sampleCount
          : typeof s.points_count === 'number'
            ? s.points_count
            : undefined
    }));

    let exemplarTraceId = typeof raw.exemplarTraceId === 'string' ? raw.exemplarTraceId : undefined;
    if (!exemplarTraceId) {
      for (const s of rawSeries) {
        if (Array.isArray(s.exemplars)) {
          for (const ex of s.exemplars) {
            const traceId = ex.labels?.trace_id || ex.labels?.traceId;
            if (isNonEmptyString(traceId)) {
              exemplarTraceId = traceId;
              break;
            }
          }
        }
        if (exemplarTraceId) {
          break;
        }
      }
    }

    const seriesCount =
      typeof raw.seriesCount === 'number'
        ? raw.seriesCount
        : typeof raw.series_count === 'number'
          ? raw.series_count
          : summarizedSeries.length;

    return {
      seriesCount,
      summarizedSeries,
      exemplarTraceId,
      finops: this.mapFinOps(raw.finops)
    };
  }

  public async queryLokiLogs(input: LokiQueryInput): Promise<LokiQueryOutput> {
    const raw = await this.callTool<Record<string, unknown>>('query_loki_logs', input);
    let logs: Array<{ timestamp?: string; stream?: Record<string, string>; line: string }> = [];

    if (Array.isArray(raw.logs)) {
      logs = raw.logs.map((item: Record<string, unknown>) => ({
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
        stream: (item.stream as Record<string, string>) || undefined,
        line: typeof item.line === 'string' ? item.line : String(item)
      }));
    } else if (Array.isArray(raw.lines)) {
      logs = (raw.lines as string[]).map((line) => ({
        line
      }));
    }

    const linesReturned =
      typeof raw.linesReturned === 'number'
        ? raw.linesReturned
        : typeof raw.lines_count === 'number'
          ? raw.lines_count
          : logs.length;

    return {
      linesReturned,
      logs,
      finops: this.mapFinOps(raw.finops)
    };
  }

  public async analyzeOtelTrace(input: TraceAnalysisInput): Promise<TraceAnalysisOutput> {
    const raw = await this.callTool<Record<string, unknown>>('analyze_otel_trace', input);
    const traceId = (raw.traceId as string) || (raw.trace_id as string) || input.trace_id;
    const servicesInvolved =
      (raw.servicesInvolved as string[]) || (raw.services_involved as string[]) || [];

    let criticalSpans: TraceSpanItem[] = [];
    if (Array.isArray(raw.criticalSpans)) {
      criticalSpans = raw.criticalSpans as TraceSpanItem[];
    } else if (Array.isArray(raw.top_errors)) {
      const topErrors = raw.top_errors as Array<Record<string, unknown>>;
      criticalSpans = topErrors.map((span) => ({
        spanId: String(span.span_id || span.spanId || ''),
        parentSpanId: span.parent_span_id ? String(span.parent_span_id) : undefined,
        serviceName: String(span.service_name || span.serviceName || ''),
        operationName: String(span.operation_name || span.operationName || ''),
        durationMs: Number(span.duration_ms || span.durationMs || 0),
        hasError: Boolean(span.has_error ?? span.hasError ?? true),
        errorMessage: span.error_message ? String(span.error_message) : undefined
      }));
    }

    return {
      traceId,
      rootServiceName:
        (raw.rootServiceName as string) ||
        ((raw.root_span as Record<string, unknown>)?.service_name as string | undefined),
      totalDurationMs: typeof raw.totalDurationMs === 'number' ? raw.totalDurationMs : undefined,
      criticalSpans,
      servicesInvolved
    };
  }

  public async searchTracesByTraceQL(input: TraceQlInput): Promise<TraceQlOutput> {
    return this.callTool<TraceQlOutput>('search_traces_by_traceql', input);
  }

  public async inspectGitDeployDiff(input: GitDeployDiffInput): Promise<GitDeployDiffOutput> {
    const raw = await this.callTool<Record<string, unknown>>('inspect_git_deploy_diff', input);
    const filesChanged = (raw.files_changed as Array<Record<string, unknown>>) || [];
    const suspectFile = raw.suspect_file as Record<string, unknown> | undefined;

    const suspectFilePath =
      (typeof raw.suspectFilePath === 'string' && raw.suspectFilePath) ||
      (typeof suspectFile?.path === 'string' && suspectFile.path) ||
      (typeof filesChanged[0]?.filename === 'string' && filesChanged[0].filename) ||
      '';

    const suspectCommitSha =
      (typeof raw.suspectCommitSha === 'string' && raw.suspectCommitSha) ||
      (typeof raw.head_ref === 'string' && raw.head_ref) ||
      (typeof raw.headRef === 'string' && raw.headRef) ||
      '';

    const authorLogin =
      (typeof raw.authorLogin === 'string' && raw.authorLogin) ||
      (typeof raw.author_login === 'string' && raw.author_login) ||
      'unknown';

    const commitMessage =
      (typeof raw.commitMessage === 'string' && raw.commitMessage) ||
      (typeof raw.commit_message === 'string' && raw.commit_message) ||
      '';

    const currentBlobSha =
      (typeof raw.currentBlobSha === 'string' && raw.currentBlobSha) ||
      (typeof suspectFile?.blob_sha === 'string' && suspectFile.blob_sha) ||
      '';

    let truncatedPatch = (typeof raw.truncatedPatch === 'string' && raw.truncatedPatch) || '';
    if (!truncatedPatch && filesChanged.length > 0) {
      const match = filesChanged.find((f) => f.filename === suspectFilePath) || filesChanged[0];
      truncatedPatch = typeof match?.patch === 'string' ? match.patch : '';
    }

    const finops = this.mapFinOps(raw.finops || raw);

    return {
      suspectCommitSha,
      authorLogin,
      commitMessage,
      suspectFilePath,
      currentBlobSha,
      truncatedPatch,
      finops
    };
  }

  public async createRemediationPr(
    input: CreateRemediationPrInput
  ): Promise<CreateRemediationPrOutput> {
    const raw = await this.callTool<Record<string, unknown>>('create_remediation_pr', input);
    return {
      branchName: String(raw.branchName ?? raw.branch_name ?? ''),
      branchUrl: String(raw.branchUrl ?? raw.branch_url ?? ''),
      pullRequestUrl: String(raw.pullRequestUrl ?? raw.pull_request_url ?? ''),
      commitSha: String(raw.commitSha ?? raw.commit_sha ?? '')
    };
  }

  public async sendPostMortemResend(input: SendPostMortemInput): Promise<SendPostMortemOutput> {
    const raw = await this.callTool<Record<string, unknown>>('send_post_mortem_resend', input);
    return {
      emailId: String(raw.emailId ?? raw.id ?? ''),
      sentAt: typeof raw.sentAt === 'string' ? raw.sentAt : undefined
    };
  }

  public async annotateGrafanaIncident(
    input: AnnotateGrafanaInput
  ): Promise<AnnotateGrafanaOutput> {
    const raw = await this.callTool<Record<string, unknown>>('annotate_grafana_incident', input);
    return {
      annotationId:
        typeof raw.annotationId === 'number'
          ? raw.annotationId
          : typeof raw.id === 'number'
            ? raw.id
            : undefined,
      success: typeof raw.success === 'boolean' ? raw.success : true
    };
  }
}
