import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { listMcpTools } from '../helpers/mcp-client.helper.js';

describe('MCP tools/list integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = bootstrap(0);
      server.on('listening', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('should return all 8 tools with valid inputSchema for MCP clients and inspector', async () => {
    const res = await listMcpTools(server);
    expect(res.status).toBe(200);

    const tools = res.tools;
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(8);

    const expectedToolNames = [
      'execute_promql_range',
      'query_loki_logs',
      'analyze_otel_trace',
      'search_traces_by_traceql',
      'inspect_git_deploy_diff',
      'create_remediation_pr',
      'send_post_mortem_resend',
      'annotate_grafana_incident'
    ];

    const actualToolNames = tools?.map((t: { name: string }) => t.name);
    expect(actualToolNames).toEqual(expect.arrayContaining(expectedToolNames));

    for (const tool of tools!) {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('should return 401 when calling tools/list without auth token', async () => {
    const res = await listMcpTools(server, '');
    expect(res.status).toBe(401);
  });

  it('should return 401 when calling tools/list with invalid auth token', async () => {
    const res = await listMcpTools(server, 'invalid-bearer-token');
    expect(res.status).toBe(401);
  });
});
