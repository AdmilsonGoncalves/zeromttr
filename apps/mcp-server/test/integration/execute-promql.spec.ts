import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import {
  setupNock,
  cleanNock,
  teardownNock,
  mockPrometheusQueryRange
} from '../helpers/nock.helper.js';

describe('Tool: execute_promql_range integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    setupNock();
    await new Promise<void>((resolve) => {
      server = bootstrap(0, { env: { PROMETHEUS_URL: 'http://localhost:9090' } });
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

  it('should execute PromQL range query, limit to 5 series and return FinOps telemetry', async () => {
    // Generate 10 series in Prometheus response
    const tenSeries = Array.from({ length: 10 }, (_, i) => ({
      metric: { job: 'api-pagamentos-core', instance: `inst-${i}` },
      values: [
        [1700000000, '10'],
        [1700000015, '20'],
        [1700000030, '30'],
        [1700000045, '40'],
        [1700000060, '100']
      ] as [number, string][]
    }));

    mockPrometheusQueryRange('http://localhost:9090', { series: tenSeries });

    const res = await callMcpTool(server, 'execute_promql_range', {
      query: 'rate(http_requests_total[5m])',
      start: '2026-11-09T10:00:00Z',
      end: '2026-11-09T11:00:00Z',
      step: '15s'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.query).toBe('rate(http_requests_total[5m])');
    // Enforces maximum of 5 series
    expect(data.series_count).toBe(5);
    expect(data.series).toHaveLength(5);

    // Verify statistical compaction
    const firstSeries = data.series[0];
    expect(firstSeries.min).toBe(10);
    expect(firstSeries.max).toBe(100);
    expect(firstSeries.latest).toBe(100);
    expect(firstSeries.avg).toBe(40);
    expect(firstSeries.p95).toBe(100);

    // Verify FinOps telemetry
    expect(data.finops).toBeDefined();
    expect(data.finops.raw_bytes_fetched).toBeGreaterThan(0);
    expect(data.finops.compacted_bytes_sent_to_llm).toBeGreaterThan(0);
    expect(data.finops.payload_reduction_percent).toBeGreaterThan(0);
    expect(data.finops.estimated_tokens_saved).toBeGreaterThan(0);
  });

  it('should reject time window exceeding 24 hours', async () => {
    const res = await callMcpTool(server, 'execute_promql_range', {
      query: 'up',
      start: '2026-11-08T00:00:00Z',
      end: '2026-11-09T01:00:00Z'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('exceeds maximum allowed window of 24h');
  });

  it('should reject when start timestamp is greater than end timestamp', async () => {
    const res = await callMcpTool(server, 'execute_promql_range', {
      query: 'up',
      start: '2026-11-09T12:00:00Z',
      end: '2026-11-09T10:00:00Z'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('must be before end');
  });

  it('should return error if Prometheus returns 500 error', async () => {
    mockPrometheusQueryRange('http://localhost:9090', { status: 500 });

    const res = await callMcpTool(server, 'execute_promql_range', {
      query: 'up',
      start: '2026-11-09T10:00:00Z',
      end: '2026-11-09T11:00:00Z'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Prometheus query failed: 500');
  });
});
