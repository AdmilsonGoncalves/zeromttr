import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import { setupNock, cleanNock, teardownNock, mockTempoGetTrace } from '../helpers/nock.helper.js';

describe('Tool: analyze_otel_trace integration', () => {
  let server: http.Server;
  const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';

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

  it('should analyze OTel trace and return Blast Radius (services_involved) and top errors/slowest', async () => {
    mockTempoGetTrace('http://localhost:3200', validTraceId);

    const res = await callMcpTool(server, 'analyze_otel_trace', {
      trace_id: validTraceId
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.trace_id).toBe(validTraceId);
    expect(data.total_spans).toBe(2);

    // Blast Radius
    expect(data.services_involved).toEqual(
      expect.arrayContaining(['api-pagamentos-core', 'postgres-db'])
    );

    // Top errors
    expect(data.top_errors).toHaveLength(1);
    expect(data.top_errors[0].spanId).toBe('span-db-err');
    expect(data.top_errors[0].serviceName).toBe('postgres-db');
    expect(data.top_errors[0].statusMessage).toBe('Pool timeout exceeded');

    // Root span and critical span
    expect(data.root_span?.spanId).toBe('span-root-1');
    expect(data.critical_span?.spanId).toBe('span-db-err');
  });

  it('should reject invalid non-hex or invalid-length trace_id', async () => {
    const res = await callMcpTool(server, 'analyze_otel_trace', {
      trace_id: 'invalid-trace-id'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Must be a 32-character hexadecimal string');
  });

  it('should return error when Tempo returns 404 for trace', async () => {
    mockTempoGetTrace('http://localhost:3200', validTraceId, { status: 404 });

    const res = await callMcpTool(server, 'analyze_otel_trace', {
      trace_id: validTraceId
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Tempo getTrace failed: 404');
  });
});
