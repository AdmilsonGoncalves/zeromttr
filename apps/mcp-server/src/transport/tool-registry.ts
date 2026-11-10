import { z } from 'zod';
import type {
  ExecutePromqlRange,
  QueryLokiLogs,
  AnalyzeOtelTrace,
  AnalyzeOtelTraceInput,
  SearchTracesByTraceQL,
  SearchTracesByTraceQLInput,
  InspectGitDeployDiff,
  CreateRemediationPr,
  SendPostMortemResend,
  AnnotateGrafanaIncident
} from '../application/index.js';
import type { PromqlQueryInput } from '../ports/metrics.port.js';
import type { LokiQueryInput } from '../ports/logs.port.js';
import type { DeployDiffRequest } from '../ports/repo-inspector.port.js';
import type { RemediationPrRequest } from '../ports/remediation.port.js';
import type { PostMortemNotification } from '../ports/notifier.port.js';
import type { AnnotationRequest } from '../ports/annotation.port.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface UseCasesRegistry {
  executePromqlRange: ExecutePromqlRange;
  queryLokiLogs: QueryLokiLogs;
  analyzeOtelTrace: AnalyzeOtelTrace;
  searchTracesByTraceQL: SearchTracesByTraceQL;
  inspectGitDeployDiff: InspectGitDeployDiff;
  createRemediationPr: CreateRemediationPr;
  sendPostMortemResend: SendPostMortemResend;
  annotateGrafanaIncident: AnnotateGrafanaIncident;
}

export class ToolRegistry {
  private readonly tools = new Map<string, McpToolDefinition>();

  constructor(private readonly useCases: UseCasesRegistry) {
    this.registerAll();
  }

  private registerAll() {
    // 1. execute_promql_range
    this.register({
      name: 'execute_promql_range',
      description:
        'Executes a PromQL range query against Prometheus, returns statistical summary (min/max/avg/latest/p95) for up to 5 series and FinOps payload reduction metrics.',
      schema: z.object({
        query: z.string().describe('The PromQL expression to evaluate'),
        start: z.string().describe('Start time in ISO8601 format'),
        end: z.string().describe('End time in ISO8601 format (max window 24h)'),
        step: z.string().optional().describe('Query resolution step duration (e.g. 15s)')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The PromQL expression to evaluate' },
          start: { type: 'string', description: 'Start time in ISO8601 format' },
          end: { type: 'string', description: 'End time in ISO8601 format (max window 24h)' },
          step: { type: 'string', description: 'Query resolution step duration (e.g. 15s)' }
        },
        required: ['query', 'start', 'end']
      },
      handler: (args) => this.useCases.executePromqlRange.execute(args as PromqlQueryInput)
    });

    // 2. query_loki_logs
    this.register({
      name: 'query_loki_logs',
      description:
        'Queries Grafana Loki logs with LogQL, enforcing defensive truncation (up to 100 lines, 500 chars per line) and FinOps metrics.',
      schema: z.object({
        logql: z.string().describe('The LogQL query expression'),
        start: z.string().describe('Start time in ISO8601 format'),
        end: z.string().describe('End time in ISO8601 format (max window 24h)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of log lines (1-100)')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          logql: { type: 'string', description: 'The LogQL query expression' },
          start: { type: 'string', description: 'Start time in ISO8601 format' },
          end: { type: 'string', description: 'End time in ISO8601 format (max window 24h)' },
          limit: { type: 'number', description: 'Maximum number of log lines (1-100)' }
        },
        required: ['logql', 'start', 'end']
      },
      handler: (args) => this.useCases.queryLokiLogs.execute(args as LokiQueryInput)
    });

    // 3. analyze_otel_trace
    this.register({
      name: 'analyze_otel_trace',
      description:
        'Analyzes an OpenTelemetry distributed trace, returning Blast Radius (services_involved), top 5 error spans, and top 5 slowest spans.',
      schema: z.object({
        trace_id: z
          .string()
          .regex(/^[0-9a-fA-F]{32}$/, 'Must be a 32-character hexadecimal string')
          .describe('The 32-character hexadecimal trace ID')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          trace_id: { type: 'string', description: 'The 32-character hexadecimal trace ID' }
        },
        required: ['trace_id']
      },
      handler: (args) => this.useCases.analyzeOtelTrace.execute(args as AnalyzeOtelTraceInput)
    });

    // 4. search_traces_by_traceql
    this.register({
      name: 'search_traces_by_traceql',
      description:
        'Searches traces in Tempo using TraceQL, returning matching traces up to limit 20.',
      schema: z.object({
        query: z.string().describe('TraceQL query string'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum traces to return (<= 20)')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'TraceQL query string' },
          limit: { type: 'number', description: 'Maximum traces to return (<= 20)' }
        },
        required: ['query']
      },
      handler: (args) =>
        this.useCases.searchTracesByTraceQL.execute(args as SearchTracesByTraceQLInput)
    });

    // 5. inspect_git_deploy_diff
    this.register({
      name: 'inspect_git_deploy_diff',
      description:
        'Inspects real Git deploy diff between two releases/tags (e.g. v2.14.7...v2.14.8), strictly sanitizing PII (no author email, stripping Co-authored-by), limiting to 3 files and 1500 chars/diff, and returning FinOps metrics.',
      schema: z.object({
        base_ref: z.string().describe('Base git reference or tag (e.g. v2.14.7)'),
        head_ref: z.string().describe('Head git reference or tag (e.g. v2.14.8)'),
        service_path: z
          .string()
          .optional()
          .describe('Path prefix filter (e.g. apps/target-app-demo)'),
        suspect_keyword: z
          .string()
          .optional()
          .describe('Keyword or filename to target suspect file')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          base_ref: { type: 'string', description: 'Base git reference or tag (e.g. v2.14.7)' },
          head_ref: { type: 'string', description: 'Head git reference or tag (e.g. v2.14.8)' },
          service_path: {
            type: 'string',
            description: 'Path prefix filter (e.g. apps/target-app-demo)'
          },
          suspect_keyword: {
            type: 'string',
            description: 'Keyword or filename to target suspect file'
          }
        },
        required: ['base_ref', 'head_ref']
      },
      handler: (args) => this.useCases.inspectGitDeployDiff.execute(args as DeployDiffRequest)
    });

    // 6. create_remediation_pr
    this.register({
      name: 'create_remediation_pr',
      description:
        'Autonomously and idempotently creates or updates a hotfix branch and opens a Pull Request on GitHub with RCA markdown and reasoning source (llm or fallback). Never auto-merges.',
      schema: z.object({
        incident_id: z.string().describe('Identifier of the incident being remediated'),
        file_path: z.string().describe('Target repository file path to patch'),
        patched_content: z.string().describe('Full patched code content'),
        blob_sha: z.string().optional().describe('Current blob SHA of target file'),
        title: z.string().describe('Pull Request title'),
        rca_markdown: z.string().describe('Root Cause Analysis and diagnosis summary in Markdown'),
        reasoning_source: z
          .enum(['llm', 'fallback'])
          .describe("Source of the remediation reasoning ('llm' | 'fallback')")
      }),
      inputSchema: {
        type: 'object',
        properties: {
          incident_id: { type: 'string', description: 'Identifier of the incident' },
          file_path: { type: 'string', description: 'Target file path to patch' },
          patched_content: { type: 'string', description: 'Full patched content' },
          blob_sha: { type: 'string', description: 'Current blob SHA of file' },
          title: { type: 'string', description: 'Pull Request title' },
          rca_markdown: { type: 'string', description: 'RCA summary in markdown' },
          reasoning_source: {
            type: 'string',
            enum: ['llm', 'fallback'],
            description: 'Reasoning source'
          }
        },
        required: [
          'incident_id',
          'file_path',
          'patched_content',
          'title',
          'rca_markdown',
          'reasoning_source'
        ]
      },
      handler: (args) => this.useCases.createRemediationPr.execute(args as RemediationPrRequest)
    });

    // 7. send_post_mortem_resend
    this.register({
      name: 'send_post_mortem_resend',
      description:
        'Dispatches post-mortem notification via Resend with escaped HTML and signed HMAC decision links in the URI fragment (#).',
      schema: z.object({
        incident_id: z.string(),
        recipient_email: z.string().optional(),
        title: z.string(),
        rca_summary: z.string(),
        evidence_coverage: z.string(),
        reasoning_source: z.enum(['llm', 'fallback']),
        blast_radius: z.array(z.string()),
        regression_commit: z.string(),
        pull_request_url: z.string(),
        approve_url: z.string(),
        reject_url: z.string(),
        leaked_patterns_detected: z.number().int().optional()
      }),
      inputSchema: {
        type: 'object',
        properties: {
          incident_id: { type: 'string' },
          recipient_email: { type: 'string' },
          title: { type: 'string' },
          rca_summary: { type: 'string' },
          evidence_coverage: { type: 'string' },
          reasoning_source: { type: 'string', enum: ['llm', 'fallback'] },
          blast_radius: { type: 'array', items: { type: 'string' } },
          regression_commit: { type: 'string' },
          pull_request_url: { type: 'string' },
          approve_url: { type: 'string' },
          reject_url: { type: 'string' },
          leaked_patterns_detected: { type: 'number' }
        },
        required: [
          'incident_id',
          'title',
          'rca_summary',
          'evidence_coverage',
          'reasoning_source',
          'blast_radius',
          'regression_commit',
          'pull_request_url',
          'approve_url',
          'reject_url'
        ]
      },
      handler: (args) => this.useCases.sendPostMortemResend.execute(args as PostMortemNotification)
    });

    // 8. annotate_grafana_incident
    this.register({
      name: 'annotate_grafana_incident',
      description:
        'Injects an incident remediation annotation into Grafana POST /api/annotations with tag aiops-remediation.',
      schema: z.object({
        time: z.number().optional().describe('Epoch millisecond timestamp of the incident'),
        text: z
          .string()
          .min(1, 'Annotation text must not be empty')
          .describe('Annotation message text'),
        tags: z.array(z.string()).optional().describe('Optional additional tags'),
        pull_request_url: z.string().optional().describe('URL to the opened Pull Request')
      }),
      inputSchema: {
        type: 'object',
        properties: {
          time: { type: 'number', description: 'Epoch ms timestamp' },
          text: { type: 'string', description: 'Annotation message text' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Additional tags' },
          pull_request_url: { type: 'string', description: 'Remediation PR URL' }
        },
        required: ['text']
      },
      handler: (args) => this.useCases.annotateGrafanaIncident.execute(args as AnnotationRequest)
    });
  }

  register(def: McpToolDefinition) {
    this.tools.set(def.name, def);
  }

  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  async callTool(name: string, rawArgs: unknown): Promise<McpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: '${name}'` }],
        isError: true
      };
    }

    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error for tool '${name}': ${JSON.stringify(parsed.error.format())}`
          }
        ],
        isError: true
      };
    }

    try {
      const result = await tool.handler(parsed.data);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: (err as Error).message || 'Tool execution error' }],
        isError: true
      };
    }
  }
}
