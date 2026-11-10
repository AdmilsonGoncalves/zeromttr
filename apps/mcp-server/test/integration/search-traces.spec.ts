import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import { setupNock, cleanNock, teardownNock, mockTempoSearch } from '../helpers/nock.helper.js';

describe('Tool: search_traces_by_traceql integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    setupNock();
    await new Promise<void>((resolve) => {
      server = bootstrap(0);
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

  it('should search traces using TraceQL and respect limit <= 20', async () => {
    mockTempoSearch('http://localhost:3200');

    const res = await callMcpTool(server, 'search_traces_by_traceql', {
      query: '{ .status = error }',
      limit: 15
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.query).toBe('{ .status = error }');
    expect(data.count).toBe(1);
    expect(data.traces[0].traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('should reject call when query is missing', async () => {
    const res = await callMcpTool(server, 'search_traces_by_traceql', {});
    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Validation error');
  });
});
