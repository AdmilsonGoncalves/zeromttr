import type http from 'node:http';
import { mcpConfig, type McpEnv } from './config/index.js';
import {
  PrometheusHttpAdapter,
  LokiHttpAdapter,
  TempoHttpAdapter,
  GithubInspectorHttpAdapter,
  GithubRemediationHttpAdapter,
  ResendHttpAdapter,
  GrafanaAnnotationsHttpAdapter
} from './adapters/index.js';
import {
  ExecutePromqlRange,
  QueryLokiLogs,
  AnalyzeOtelTrace,
  SearchTracesByTraceQL,
  InspectGitDeployDiff,
  CreateRemediationPr,
  SendPostMortemResend,
  AnnotateGrafanaIncident
} from './application/index.js';
import { ToolRegistry, createMcpHttpServer, logger } from './transport/index.js';

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
    from: env.RESEND_FROM
  });
  const grafanaAdapter = new GrafanaAnnotationsHttpAdapter({
    baseUrl: env.GRAFANA_URL,
    apiToken: env.GRAFANA_TOKEN
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
