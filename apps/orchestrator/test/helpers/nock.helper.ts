import nock from 'nock';

export const TEST_MCP_BASE_URL = 'http://mcp-server.test:8000';
export const TEST_TARGET_APP_URL = 'http://target-app.test:3000';

export function setupOrchestratorNock(): void {
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));
}

export function cleanOrchestratorNock(): void {
  nock.cleanAll();
}

export function teardownOrchestratorNock(): void {
  nock.cleanAll();
  nock.enableNetConnect();
}

export interface CapturedMcpCalls {
  sendPostMortemArgs?: Record<string, unknown>;
  createPrArgs?: Record<string, unknown>;
  annotateArgs: Array<Record<string, unknown>>;
}

interface JsonRpcRequestBody {
  id?: number;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

function wrapJsonRpcResult(payload: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload)
        }
      ]
    }
  };
}

export function mockTargetAppStatusEndpoint(
  overrides: {
    status?: 'healthy' | 'degraded' | 'unreachable';
    version?: string;
    previousHealthyVersion?: string;
  } = {}
): nock.Scope {
  return nock(TEST_TARGET_APP_URL)
    .persist()
    .get('/chaos/status')
    .reply(200, {
      status: overrides.status ?? 'degraded',
      service: 'api-pagamentos-core',
      version: overrides.version ?? 'v2.14.8',
      previousHealthyVersion: overrides.previousHealthyVersion ?? 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: '2026-11-10T12:00:00Z ERROR raw edge log [REDACTED]'
    });
}

export function mockMcpJsonRpcEndpoint(
  mcpToken: string,
  options: {
    lokiLines?: string[];
    suspectFilePath?: string;
  } = {}
): { scope: nock.Scope; captured: CapturedMcpCalls } {
  const captured: CapturedMcpCalls = {
    annotateArgs: []
  };

  const lokiLines = options.lokiLines ?? [
    '[2026-11-10T12:00:01Z] ERROR KnexTimeoutError: pool exhausted [REDACTED_CPF]'
  ];
  const suspectFilePath =
    options.suspectFilePath ?? 'apps/target-app-demo/src/repositories/payment.repository.ts';

  const registerTool = (
    toolName: string,
    resultPayload: Record<string, unknown>,
    onMatch?: (args: Record<string, unknown>) => void,
    persist = false
  ): nock.Scope => {
    const scope = nock(TEST_MCP_BASE_URL);
    if (persist) {
      scope.persist();
    }
    return scope
      .matchHeader('authorization', `Bearer ${mcpToken}`)
      .post('/mcp', (body: JsonRpcRequestBody) => {
        if (body?.params?.name !== toolName) {
          return false;
        }
        if (onMatch && body.params.arguments) {
          onMatch(body.params.arguments);
        }
        return true;
      })
      .reply(200, wrapJsonRpcResult(resultPayload));
  };

  const rootScope = registerTool('execute_promql_range', {
    seriesCount: 1,
    series: [
      {
        metric: { service_name: 'api-pagamentos-core' },
        p50: 120,
        p95: 4710,
        max: 5000,
        points_count: 10
      }
    ],
    exemplarTraceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    finops: {
      raw_bytes_fetched: 12000,
      compacted_bytes_sent_to_llm: 1200,
      payload_reduction_percent: 90,
      estimated_tokens_saved: 2700
    }
  });

  registerTool('analyze_otel_trace', {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    totalDurationMs: 4710,
    servicesInvolved: ['api-pagamentos-core', 'postgres-pagamentos'],
    criticalSpans: [
      {
        spanId: 'span-001',
        serviceName: 'api-pagamentos-core',
        operationName: 'pg.pool.acquire',
        durationMs: 4710,
        hasError: true,
        errorMessage: 'KnexTimeoutError: pool exhausted'
      }
    ]
  });

  registerTool('query_loki_logs', {
    linesReturned: lokiLines.length,
    logs: lokiLines.map((line, index) => ({
      timestamp: `2026-11-10T12:00:0${index}Z`,
      line
    })),
    finops: {
      raw_bytes_fetched: 8000,
      compacted_bytes_sent_to_llm: 900,
      payload_reduction_percent: 88.75,
      estimated_tokens_saved: 1775
    }
  });

  registerTool('inspect_git_deploy_diff', {
    suspectCommitSha: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
    authorLogin: 'dev-engineer',
    suspectFilePath,
    currentBlobSha: 'blob-sha-v2148',
    truncatedPatch: '- max: 10\n+ max: 2',
    finops: {
      raw_bytes_fetched: 15000,
      compacted_bytes_sent_to_llm: 1500,
      payload_reduction_percent: 90,
      estimated_tokens_saved: 3375
    }
  });

  registerTool(
    'annotate_grafana_incident',
    { annotationId: 401, success: true },
    (args) => captured.annotateArgs.push(args),
    true
  );

  registerTool(
    'create_remediation_pr',
    {
      branchName: 'hotfix/zeromttr-e2e',
      branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-e2e',
      pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/99',
      commitSha: 'commit-remediation-99'
    },
    (args) => {
      captured.createPrArgs = args;
    }
  );

  registerTool(
    'send_post_mortem_resend',
    {
      emailId: 'email-resend-e2e-001',
      sentAt: '2026-11-10T12:00:30.000Z'
    },
    (args) => {
      captured.sendPostMortemArgs = args;
    }
  );

  return { scope: rootScope, captured };
}
