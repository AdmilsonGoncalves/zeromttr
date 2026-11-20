import type http from 'node:http';
import { mcpConfig, type McpEnv } from './config/env.js';
import { PrometheusHttpAdapter } from './adapters/prometheus.http.js';
import { LokiHttpAdapter } from './adapters/loki.http.js';
import { TempoHttpAdapter } from './adapters/tempo.http.js';
import { GithubInspectorHttpAdapter } from './adapters/github-inspector.http.js';
import { GithubRemediationHttpAdapter } from './adapters/github-remediation.http.js';
import { ResendHttpAdapter } from './adapters/resend.http.js';
import { GrafanaAnnotationsHttpAdapter } from './adapters/grafana-annotations.http.js';
import { ExecutePromqlRange } from './application/execute-promql-range.js';
import { QueryLokiLogs } from './application/query-loki-logs.js';
import { AnalyzeOtelTrace } from './application/analyze-otel-trace.js';
import { SearchTracesByTraceQL } from './application/search-traces-by-traceql.js';
import { InspectGitDeployDiff } from './application/inspect-git-deploy-diff.js';
import { CreateRemediationPr } from './application/create-remediation-pr.js';
import { SendPostMortemResend } from './application/send-post-mortem-resend.js';
import { AnnotateGrafanaIncident } from './application/annotate-grafana-incident.js';
import { ToolRegistry } from './transport/tool-registry.js';
import { createMcpHttpServer } from './transport/mcp-server.js';
import { logger } from './transport/logger.js';

export interface BootstrapOverrides {
  env?: Partial<McpEnv>;
  serverOptions?: {
    sessionTtlMs?: number;
    sessionCleanupIntervalMs?: number;
  };
}

export function buildMcpServer(overrides?: BootstrapOverrides): {
  server: http.Server;
  toolRegistry: ToolRegistry;
} {
  const env = { ...mcpConfig, ...(overrides?.env || {}) };

  // 1. Adapters
  const prometheusAdapter = new PrometheusHttpAdapter({ baseUrl: env.PROMETHEUS_URL });
  const lokiAdapter = new LokiHttpAdapter({ baseUrl: env.LOKI_URL });
  const tempoAdapter = new TempoHttpAdapter({ baseUrl: env.TEMPO_URL });
  const githubInspectorAdapter = new GithubInspectorHttpAdapter({
    repo: env.TARGET_GITHUB_REPO,
    githubToken: env.GITHUB_TOKEN
  });
  const githubRemediationAdapter = new GithubRemediationHttpAdapter({
    repo: env.TARGET_GITHUB_REPO,
    baseBranch: env.TARGET_BASE_BRANCH,
    githubToken: env.GITHUB_TOKEN
  });
  const resendAdapter = new ResendHttpAdapter({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM,
    defaultRecipient: env.ON_CALL_ENGINEER_EMAIL
  });
  const grafanaAdapter = new GrafanaAnnotationsHttpAdapter({
    baseUrl: env.GRAFANA_URL,
    apiToken: env.GRAFANA_TOKEN,
    basicAuth: env.GRAFANA_ADMIN_PASSWORD
      ? { username: env.GRAFANA_ADMIN_USER, password: env.GRAFANA_ADMIN_PASSWORD }
      : undefined
  });

  // 2. Application Use Cases
  const executePromqlRange = new ExecutePromqlRange(prometheusAdapter);
  const queryLokiLogs = new QueryLokiLogs(lokiAdapter);
  const analyzeOtelTrace = new AnalyzeOtelTrace(tempoAdapter);
  const searchTracesByTraceQL = new SearchTracesByTraceQL(tempoAdapter);
  const inspectGitDeployDiff = new InspectGitDeployDiff(githubInspectorAdapter);
  const createRemediationPr = new CreateRemediationPr(githubRemediationAdapter);
  const sendPostMortemResend = new SendPostMortemResend(resendAdapter);
  const annotateGrafanaIncident = new AnnotateGrafanaIncident(grafanaAdapter);

  // 3. Tool Registry
  const toolRegistry = new ToolRegistry({
    executePromqlRange,
    queryLokiLogs,
    analyzeOtelTrace,
    searchTracesByTraceQL,
    inspectGitDeployDiff,
    createRemediationPr,
    sendPostMortemResend,
    annotateGrafanaIncident
  });

  // 4. HTTP Transport Server
  const server = createMcpHttpServer({
    authToken: env.MCP_AUTH_TOKEN,
    toolRegistry,
    ...overrides?.serverOptions
  });

  return { server, toolRegistry };
}

export function bootstrap(
  port: number = mcpConfig.MCP_PORT,
  overrides?: BootstrapOverrides
): http.Server {
  const { server } = buildMcpServer(overrides);

  server.listen(port, () => {
    logger.info(`[mcp-server] Initialized on port ${port}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
