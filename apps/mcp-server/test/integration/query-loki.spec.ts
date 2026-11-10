import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import { setupNock, cleanNock, teardownNock, mockLokiQueryRange } from '../helpers/nock.helper.js';

describe('Tool: query_loki_logs integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    setupNock();
    await new Promise<void>((resolve) => {
      server = bootstrap(0, { env: { LOKI_URL: 'http://localhost:3100' } });
      server.on('listening', () => resolve());
    });
  });

  afterAll(async () => {
    teardownNock();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    cleanNock();
  });

  it('should query Loki logs, enforce defensive truncation (500 chars/line) and return FinOps', async () => {
    const longLine = 'ERROR: knex timeout acquiring connection ' + 'x'.repeat(600);
    const lines = [
      'INFO: payment started [REDACTED_CPF]',
      longLine,
      'WARN: connection pool capacity reached'
    ];

    mockLokiQueryRange('http://localhost:3100', { lines });

    const res = await callMcpTool(server, 'query_loki_logs', {
      logql: '{app="target-app-demo"}',
      start: '2026-11-09T10:00:00Z',
      end: '2026-11-09T11:00:00Z',
      limit: 10
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.logql).toBe('{app="target-app-demo"}');
    expect(data.lines_count).toBe(3);
    expect(data.lines[0]).toBe('INFO: payment started [REDACTED_CPF]');

    // Truncated line check
    expect(data.lines[1].length).toBeLessThanOrEqual(503);
    expect(data.lines[1]).toContain('...');

    // FinOps telemetry check
    expect(data.finops).toBeDefined();
    expect(data.finops.raw_bytes_fetched).toBeGreaterThan(0);
    expect(data.finops.compacted_bytes_sent_to_llm).toBeGreaterThan(0);
    expect(data.finops.payload_reduction_percent).toBeGreaterThanOrEqual(0);
  });

  it('should reject time window exceeding 24 hours', async () => {
    const res = await callMcpTool(server, 'query_loki_logs', {
      logql: '{app="target-app-demo"}',
      start: '2026-11-08T00:00:00Z',
      end: '2026-11-09T01:00:00Z'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('exceeds maximum allowed window of 24h');
  });

  it('should return error if Loki returns 502 Bad Gateway', async () => {
    mockLokiQueryRange('http://localhost:3100', { status: 502 });

    const res = await callMcpTool(server, 'query_loki_logs', {
      logql: '{app="target-app-demo"}',
      start: '2026-11-09T10:00:00Z',
      end: '2026-11-09T11:00:00Z'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Loki query failed: 502');
  });
});
