import { z } from 'zod';
import {
  isArray,
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  parseNumber,
  safeJsonParse
} from '@zeromttr/utils';
import { buildUrl, isHttpSuccess, sanitizeHeaderValue } from '@zeromttr/utils/http';
import { OrchestratorDefault } from '../domain/incident-enums.js';
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
} from '../ports/tools.port.js';

const McpJsonRpcPayloadSchema = z.object({
  result: z
    .object({
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string()
          })
        )
        .optional(),
      isError: z.boolean().optional()
    })
    .optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string()
    })
    .optional()
});

function toStringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isString(entry)) {
      result[key] = entry;
    }
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (!isArray(value)) {
    return [];
  }
  return value.filter(isString);
}

function firstNonEmptyString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate;
    }
  }
  return '';
}

function inferSpanHasError(span: Record<string, unknown>, defaultHasError?: boolean): boolean {
  if (typeof span.hasError === 'boolean') {
    return span.hasError;
  }
  if (typeof span.has_error === 'boolean') {
    return span.has_error;
  }
  if (
    span.statusCode === 2 ||
    span.statusCode === 'ERROR' ||
    span.statusCode === 'STATUS_CODE_ERROR'
  ) {
    return true;
  }
  if (isObject(span.attributes)) {
    const attrs = span.attributes;
    if (attrs.error === true || attrs.error === 'true') {
      return true;
    }
    const httpStatus = Number(attrs['http.status_code'] ?? attrs['http.response.status_code']);
    if (isNumber(httpStatus) && httpStatus >= 500) {
      return true;
    }
  }
  return defaultHasError ?? false;
}

function mapTraceSpanItem(item: unknown, defaultHasError?: boolean): TraceSpanItem {
  const span = isObject(item) ? item : {};
  const parentSpanRaw = span.parentSpanId ?? span.parent_span_id;
  const errorMessageRaw =
    span.errorMessage ?? span.error_message ?? span.statusMessage ?? span.status_message;

  return {
    spanId: String(span.spanId ?? span.span_id ?? ''),
    parentSpanId: isNonEmptyString(parentSpanRaw)
      ? parentSpanRaw
      : parentSpanRaw !== undefined && parentSpanRaw !== null
        ? String(parentSpanRaw)
        : undefined,
    serviceName: String(span.serviceName ?? span.service_name ?? ''),
    operationName: String(span.operationName ?? span.operation_name ?? span.name ?? ''),
    durationMs: parseNumber(span.durationMs ?? span.duration_ms, 0),
    hasError: inferSpanHasError(span, defaultHasError),
    errorMessage: isNonEmptyString(errorMessageRaw)
      ? errorMessageRaw
      : errorMessageRaw !== undefined && errorMessageRaw !== null
        ? String(errorMessageRaw)
        : undefined
  };
}

function normalizeMcpUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    if (cleanPath.endsWith('/mcp')) {
      parsed.pathname = cleanPath;
      return parsed.toString();
    }
    parsed.pathname = `${cleanPath}/mcp`;
    return parsed.toString();
  } catch {
    const clean = rawUrl.replace(/\/+$/, '');
    return `${clean}${clean.endsWith('/mcp') ? '' : '/mcp'}`;
  }
}

export class McpClientAdapter implements ToolsPort {
  private readonly baseUrl: string;
  private readonly authToken: string;

  public constructor(baseUrl?: string, authToken?: string) {
    const envBaseUrl =
      process.env.MCP_SERVER_URL ||
      (process.env.MCP_URL ? normalizeMcpUrl(process.env.MCP_URL) : undefined);
    this.baseUrl = buildUrl(baseUrl || envBaseUrl || 'http://localhost:8000/mcp');
    const isTest = process.env.NODE_ENV === 'test';
    const token = authToken || process.env.MCP_AUTH_TOKEN || (isTest ? 'test-mcp-token' : '');
    if (!isTest && !token) {
      throw new Error('FATAL: MCP_AUTH_TOKEN must be configured.');
    }
    this.authToken = sanitizeHeaderValue(token);
  }

  private mapFinOps(finops: unknown): FinOpsData {
    if (!isObject(finops)) {
      return {
        rawBytesFetched: 0,
        compactedBytesSentToLlm: 0,
        payloadReductionPercent: 0,
        estimatedTokensSaved: 0
      };
    }
    return {
      rawBytesFetched: parseNumber(finops.rawBytesFetched ?? finops.raw_bytes_fetched, 0),
      compactedBytesSentToLlm: parseNumber(
        finops.compactedBytesSentToLlm ?? finops.compacted_bytes_sent_to_llm,
        0
      ),
      payloadReductionPercent: parseNumber(
        finops.payloadReductionPercent ?? finops.payload_reduction_percent,
        0
      ),
      estimatedTokensSaved: parseNumber(
        finops.estimatedTokensSaved ?? finops.estimated_tokens_saved,
        0
      )
    };
  }

  private async callTool(name: string, args: unknown): Promise<Record<string, unknown>> {
    const timeoutMs = parseNumber(process.env.MCP_TIMEOUT_MS, 30_000);
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

    const parsedEnvelope = McpJsonRpcPayloadSchema.safeParse(await response.json());
    if (!parsedEnvelope.success) {
      throw new Error(`MCP JSON-RPC returned malformed envelope for tool '${name}'`);
    }
    const payload = parsedEnvelope.data;

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

    const parsed = safeJsonParse(outputText);
    if (!isObject(parsed)) {
      throw new Error(`MCP tool '${name}' response could not be parsed as a valid JSON object`);
    }
    return parsed;
  }

  /**
   * Queries Prometheus metrics over a time range via the MCP server and normalizes the series summary.
   */
  public async executePromqlRange(input: PromqlRangeInput): Promise<PromqlRangeOutput> {
    const raw = await this.callTool('execute_promql_range', input);
    const rawSeriesInput = isArray(raw.series)
      ? raw.series
      : isArray(raw.summarizedSeries)
        ? raw.summarizedSeries
        : [];
    const rawSeries = rawSeriesInput.filter(isObject);

    const summarizedSeries = rawSeries.map((s) => ({
      metric: toStringRecord(s.metric),
      p50: isNumber(s.p50) ? s.p50 : isNumber(s.avg) ? s.avg : undefined,
      p95: isNumber(s.p95) ? s.p95 : undefined,
      max: isNumber(s.max) ? s.max : undefined,
      sampleCount: isNumber(s.sampleCount)
        ? s.sampleCount
        : isNumber(s.points_count)
          ? s.points_count
          : undefined
    }));

    let exemplarTraceId = isString(raw.exemplarTraceId) ? raw.exemplarTraceId : undefined;
    if (!exemplarTraceId) {
      for (const s of rawSeries) {
        if (isArray(s.exemplars)) {
          for (const ex of s.exemplars) {
            if (!isObject(ex) || !isObject(ex.labels)) {
              continue;
            }
            const traceId = ex.labels.trace_id ?? ex.labels.traceId;
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

    const seriesCount = isNumber(raw.seriesCount)
      ? raw.seriesCount
      : isNumber(raw.series_count)
        ? raw.series_count
        : summarizedSeries.length;

    return {
      seriesCount,
      summarizedSeries,
      exemplarTraceId,
      finops: this.mapFinOps(raw.finops)
    };
  }

  /**
   * Queries Loki logs via the MCP server and maps returned log entries and FinOps metrics.
   */
  public async queryLokiLogs(input: LokiQueryInput): Promise<LokiQueryOutput> {
    const raw = await this.callTool('query_loki_logs', input);
    let logs: Array<{ timestamp?: string; stream?: Record<string, string>; line: string }> = [];

    if (isArray(raw.logs)) {
      logs = raw.logs.map((entry) => {
        const item = isObject(entry) ? entry : {};
        return {
          timestamp: isString(item.timestamp) ? item.timestamp : undefined,
          stream: isObject(item.stream) ? toStringRecord(item.stream) : undefined,
          line: isString(item.line) ? item.line : String(entry)
        };
      });
    } else if (isArray(raw.lines)) {
      logs = raw.lines.filter(isString).map((line) => ({
        line
      }));
    }

    const linesReturned = isNumber(raw.linesReturned)
      ? raw.linesReturned
      : isNumber(raw.lines_count)
        ? raw.lines_count
        : logs.length;

    return {
      linesReturned,
      logs,
      finops: this.mapFinOps(raw.finops)
    };
  }

  /**
   * Analyzes an OpenTelemetry trace via MCP and extracts involved services and critical spans.
   */
  public async analyzeOtelTrace(input: TraceAnalysisInput): Promise<TraceAnalysisOutput> {
    const raw = await this.callTool('analyze_otel_trace', input);
    const traceId = firstNonEmptyString(raw.traceId, raw.trace_id) || input.trace_id;
    const servicesInvolved = isArray(raw.servicesInvolved)
      ? toStringArray(raw.servicesInvolved)
      : toStringArray(raw.services_involved);

    let criticalSpans: TraceSpanItem[] = [];
    if (isArray(raw.criticalSpans)) {
      criticalSpans = raw.criticalSpans.map((item) => mapTraceSpanItem(item));
    } else if (isArray(raw.top_errors) && raw.top_errors.length > 0) {
      criticalSpans = raw.top_errors.map((item) => mapTraceSpanItem(item, true));
    } else if (isArray(raw.top_slowest)) {
      criticalSpans = raw.top_slowest.map((item) => mapTraceSpanItem(item, false));
    }

    const rootSpan = isObject(raw.root_span) ? raw.root_span : undefined;
    const rootServiceName = firstNonEmptyString(
      raw.rootServiceName,
      rootSpan?.serviceName,
      rootSpan?.service_name
    );
    const totalDurationMs = isNumber(raw.totalDurationMs)
      ? raw.totalDurationMs
      : isNumber(rootSpan?.durationMs)
        ? rootSpan.durationMs
        : undefined;

    return {
      traceId,
      rootServiceName: isNonEmptyString(rootServiceName) ? rootServiceName : undefined,
      totalDurationMs,
      criticalSpans,
      servicesInvolved
    };
  }

  /**
   * Searches Tempo traces matching a TraceQL query via the MCP server.
   */
  public async searchTracesByTraceQL(input: TraceQlInput): Promise<TraceQlOutput> {
    const raw = await this.callTool('search_traces_by_traceql', input);
    const traces = isArray(raw.traces)
      ? raw.traces.filter(isObject).map((trace) => ({
          traceId: String(trace.traceId ?? trace.traceID ?? ''),
          durationMs: parseNumber(trace.durationMs, 0),
          errorCount: parseNumber(trace.errorCount, 0),
          rootServiceName: String(trace.rootServiceName ?? '')
        }))
      : [];
    return { traces };
  }

  /**
   * Fetches commit metadata and truncated diffs between two Git refs via the MCP server.
   */
  public async inspectGitDeployDiff(input: GitDeployDiffInput): Promise<GitDeployDiffOutput> {
    const raw = await this.callTool('inspect_git_deploy_diff', input);
    const filesChanged = isArray(raw.files_changed) ? raw.files_changed.filter(isObject) : [];
    const suspectFile = isObject(raw.suspect_file) ? raw.suspect_file : undefined;

    const suspectFilePath = firstNonEmptyString(
      raw.suspectFilePath,
      suspectFile?.path,
      filesChanged[0]?.filename
    );

    const suspectCommitSha = firstNonEmptyString(raw.suspectCommitSha, raw.head_ref, raw.headRef);

    const authorLogin =
      firstNonEmptyString(raw.authorLogin, raw.author_login) || OrchestratorDefault.UNKNOWN;

    const commitMessage = firstNonEmptyString(raw.commitMessage, raw.commit_message);

    const currentBlobSha = firstNonEmptyString(raw.currentBlobSha, suspectFile?.blob_sha);

    let truncatedPatch = isNonEmptyString(raw.truncatedPatch) ? raw.truncatedPatch : '';
    if (!truncatedPatch && filesChanged.length > 0) {
      const match = filesChanged.find((f) => f.filename === suspectFilePath) || filesChanged[0];
      truncatedPatch = isString(match?.patch) ? match.patch : '';
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

  /**
   * Opens or reuses a remediation hotfix Pull Request on GitHub via the MCP server.
   */
  public async createRemediationPr(
    input: CreateRemediationPrInput
  ): Promise<CreateRemediationPrOutput> {
    const raw = await this.callTool('create_remediation_pr', input);
    return {
      branchName: String(raw.branchName ?? raw.branch_name ?? ''),
      branchUrl: String(raw.branchUrl ?? raw.branch_url ?? ''),
      pullRequestUrl: String(raw.pullRequestUrl ?? raw.pull_request_url ?? ''),
      commitSha: String(raw.commitSha ?? raw.commit_sha ?? '')
    };
  }

  /**
   * Sends the post-mortem email with signed decision links via the MCP Resend tool.
   */
  public async sendPostMortemResend(input: SendPostMortemInput): Promise<SendPostMortemOutput> {
    const raw = await this.callTool('send_post_mortem_resend', input);
    return {
      emailId: String(raw.emailId ?? raw.id ?? ''),
      sentAt: isString(raw.sentAt) ? raw.sentAt : undefined
    };
  }

  /**
   * Creates an incident timeline annotation in Grafana via the MCP server.
   */
  public async annotateGrafanaIncident(
    input: AnnotateGrafanaInput
  ): Promise<AnnotateGrafanaOutput> {
    const raw = await this.callTool('annotate_grafana_incident', input);
    return {
      annotationId: isNumber(raw.annotationId)
        ? raw.annotationId
        : isNumber(raw.id)
          ? raw.id
          : undefined,
      success: typeof raw.success === 'boolean' ? raw.success : true
    };
  }
}
