import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import nock from 'nock';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import { setupNock, cleanNock, teardownNock, mockTempoSearch } from '../helpers/nock.helper.js';

describe('Tool: search_traces_by_traceql integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    setupNock();
    await new Promise<void>((resolve) => {
      server = bootstrap(0, { env: { TEMPO_URL: 'http://localhost:3200' } });
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

  it('should search traces using TraceQL, enforce time bounds, and respect limit <= 20', async () => {
    const startIso = '2026-11-01T10:00:00+02:00';
    const endIso = '2026-11-01T11:00:00+02:00';
    const scope = nock('http://localhost:3200')
      .get('/api/search')
      .query({
        q: '{ .status = error }',
        limit: '15',
        start: String(Math.floor(Date.parse('2026-11-01T08:00:00Z') / 1000)),
        end: String(Math.floor(Date.parse('2026-11-01T09:00:00Z') / 1000))
      })
      .reply(200, {
        traces: [
          {
            traceID: '4bf92f3577b34da6a3ce929d0e0e4736',
            rootServiceName: 'api-pagamentos-core',
            rootTraceName: 'POST /api/payments',
            durationMs: 5000
          }
        ]
      });

    const res = await callMcpTool(server, 'search_traces_by_traceql', {
      query: '{ .status = error }',
      limit: 15,
      start: startIso,
      end: endIso
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);
    expect(scope.isDone()).toBe(true);

    const data = res.parsedContent;
    expect(data.query).toBe('{ .status = error }');
    expect(data.count).toBe(1);
    expect(data.traces[0].traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('should complete start-only windows with current timestamp as end bound', async () => {
    const startIso = '2026-11-01T10:00:00Z';
    const expectedStart = String(Math.floor(Date.parse(startIso) / 1000));
    const scope = nock('http://localhost:3200')
      .get('/api/search')
      .query((q) => {
        return (
          q.q === '{ .status = error }' &&
          q.start === expectedStart &&
          Number(q.end) >= Number(expectedStart)
        );
      })
      .reply(200, {
        traces: [
          {
            traceID: '4bf92f3577b34da6a3ce929d0e0e4736',
            rootServiceName: 'api-pagamentos-core',
            rootTraceName: 'POST /api/payments',
            durationMs: 5000
          }
        ]
      });

    const res = await callMcpTool(server, 'search_traces_by_traceql', {
      query: '{ .status = error }',
      start: startIso
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);
    expect(scope.isDone()).toBe(true);
  });

  it('should pad leading zeros on traceId returned by Tempo search to 32 hex chars', async () => {
    mockTempoSearch('http://localhost:3200', {
      traces: [
        {
          traceID: '25f21ef64d6bd75a7089b2a45e602a8',
          rootServiceName: 'api-pagamentos-core',
          rootTraceName: 'POST /api/payments',
          durationMs: 4605
        }
      ]
    });

    const res = await callMcpTool(server, 'search_traces_by_traceql', {
      query: '{ .status = error }'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);
    expect(res.parsedContent.traces[0].traceId).toBe('025f21ef64d6bd75a7089b2a45e602a8');
  });

  it('should reject call when query is missing', async () => {
    const res = await callMcpTool(server, 'search_traces_by_traceql', {});
    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Validation error');
  });
});
