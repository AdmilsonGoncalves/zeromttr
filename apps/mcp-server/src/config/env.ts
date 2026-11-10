import { z } from 'zod';

const envSchema = z.object({
  MCP_PORT: z.coerce.number().default(8000),
  MCP_AUTH_TOKEN: z.string().min(1).default('dev-mcp-token'),
  PROMETHEUS_URL: z.string().default('http://localhost:9090'),
  LOKI_URL: z.string().default('http://localhost:3100'),
  TEMPO_URL: z.string().default('http://localhost:3200'),
  GRAFANA_URL: z.string().default('http://localhost:3000'),
  GRAFANA_API_TOKEN: z.string().default(''),
  GRAFANA_SA_TOKEN: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  TARGET_GITHUB_REPO: z.string().default('AdmilsonGoncalves/zeromttr'),
  TARGET_BASE_BRANCH: z.string().default('release/target-v2.14.8'),
  TARGET_SERVICE_PATH: z.string().default('apps/target-app-demo'),
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default('ZeroMTTR - AGJ Works <sre@send.zeromttr.agjworks.com>'),
  PUBLIC_DASHBOARD_URL: z.string().default('http://localhost:4200'),
  NODE_ENV: z.string().default('development')
});

export function loadEnv(rawEnv: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.format())}`);
  }

  const data = parsed.data;

  // In production, require MCP_AUTH_TOKEN
  if (
    data.NODE_ENV === 'production' &&
    (!data.MCP_AUTH_TOKEN || data.MCP_AUTH_TOKEN === 'dev-mcp-token')
  ) {
    throw new Error('MCP_AUTH_TOKEN must be defined and non-empty in production');
  }

  // Parse repo owner/repo if full URL was provided
  let repo = data.TARGET_GITHUB_REPO;
  if (repo.startsWith('http://') || repo.startsWith('https://')) {
    const url = new URL(repo);
    repo = url.pathname.replace(/^\/|\/$/g, '');
  }

  return {
    ...data,
    TARGET_GITHUB_REPO: repo,
    GRAFANA_TOKEN: data.GRAFANA_API_TOKEN || data.GRAFANA_SA_TOKEN
  };
}

export type McpEnv = ReturnType<typeof loadEnv>;

export const mcpConfig = loadEnv();
