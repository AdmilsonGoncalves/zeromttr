import { isNonEmptyString, safeJsonParse } from '@zeromttr/utils';
import { buildUrl, isHttpSuccess, sanitizeHeaderValue } from '@zeromttr/utils/http';
import type {
  ToolsPort,
  PromqlRangeInput,
  PromqlRangeOutput,
  LokiQueryInput,
  LokiQueryOutput,
  TraceAnalysisInput,
  TraceAnalysisOutput,
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
      return {} as T;
    }

    const parsed = safeJsonParse<T>(outputText);
    return parsed ?? ({} as T);
  }

  public async executePromqlRange(input: PromqlRangeInput): Promise<PromqlRangeOutput> {
    return this.callTool<PromqlRangeOutput>('execute_promql_range', input);
  }

  public async queryLokiLogs(input: LokiQueryInput): Promise<LokiQueryOutput> {
    return this.callTool<LokiQueryOutput>('query_loki_logs', input);
  }

  public async analyzeOtelTrace(input: TraceAnalysisInput): Promise<TraceAnalysisOutput> {
    return this.callTool<TraceAnalysisOutput>('analyze_otel_trace', input);
  }

  public async searchTracesByTraceQL(input: TraceQlInput): Promise<TraceQlOutput> {
    return this.callTool<TraceQlOutput>('search_traces_by_traceql', input);
  }

  public async inspectGitDeployDiff(input: GitDeployDiffInput): Promise<GitDeployDiffOutput> {
    return this.callTool<GitDeployDiffOutput>('inspect_git_deploy_diff', input);
  }

  public async createRemediationPr(
    input: CreateRemediationPrInput
  ): Promise<CreateRemediationPrOutput> {
    return this.callTool<CreateRemediationPrOutput>('create_remediation_pr', input);
  }

  public async sendPostMortemResend(input: SendPostMortemInput): Promise<SendPostMortemOutput> {
    return this.callTool<SendPostMortemOutput>('send_post_mortem_resend', input);
  }

  public async annotateGrafanaIncident(
    input: AnnotateGrafanaInput
  ): Promise<AnnotateGrafanaOutput> {
    return this.callTool<AnnotateGrafanaOutput>('annotate_grafana_incident', input);
  }
}
