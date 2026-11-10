import { describe, it, expect } from 'vitest';
import {
  analyzeSpans,
  SpanAnalyzer,
  extractOtelAttributeValue,
  type RawSpan
} from '../../src/domain/span-analysis.js';

describe('SpanAnalyzer domain', () => {
  const sampleSpans: RawSpan[] = [
    {
      spanId: 'span-root',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      name: 'HTTP POST /api/payments',
      serviceName: 'api-pagamentos-core',
      durationMs: 2500,
      statusCode: 'OK',
      attributes: {
        'http.status_code': 200,
        'http.method': 'POST'
      }
    },
    {
      spanId: 'span-db-1',
      parentSpanId: 'span-root',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      name: 'pg.query: acquireConnection',
      serviceName: 'postgres-db',
      durationMs: 5000,
      statusCode: 'ERROR',
      statusMessage: 'Connection pool exhausted timeout',
      attributes: {
        error: true,
        'db.system': 'postgresql'
      }
    },
    {
      spanId: 'span-redis-1',
      parentSpanId: 'span-root',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      name: 'redis.get: idempotency-key',
      serviceName: 'redis-cache',
      durationMs: 15,
      statusCode: 'OK',
      attributes: {
        'redis.key': 'idemp:123'
      }
    }
  ];

  it('should analyze spans and identify top errors and slowest spans', () => {
    const summary = SpanAnalyzer.analyze(sampleSpans);

    expect(summary.totalSpans).toBe(3);
    expect(summary.services_involved).toEqual([
      'api-pagamentos-core',
      'postgres-db',
      'redis-cache'
    ]);
    expect(summary.top5Errors).toHaveLength(1);
    expect(summary.top5Errors[0].spanId).toBe('span-db-1');
    expect(summary.top5Errors[0].statusMessage).toContain('Connection pool exhausted');
    expect(summary.top5Slowest[0].spanId).toBe('span-db-1');
    expect(summary.top5Slowest[0].durationMs).toBe(5000);
    expect(summary.rootSpan?.spanId).toBe('span-root');
    expect(summary.criticalSpan?.spanId).toBe('span-db-1');
  });

  it('should safely extract OTel attributes checking key presence with in', () => {
    const rawAttrString = { stringValue: 'hello' };
    const rawAttrBool = { boolValue: false };
    const rawAttrNum = { intValue: 0 };
    const rawAttrDouble = { doubleValue: 0.0 };

    expect(extractOtelAttributeValue(rawAttrString)).toBe('hello');
    expect(extractOtelAttributeValue(rawAttrBool)).toBe(false);
    expect(extractOtelAttributeValue(rawAttrNum)).toBe(0);
    expect(extractOtelAttributeValue(rawAttrDouble)).toBe(0);
    expect(extractOtelAttributeValue('plain-string')).toBe('plain-string');
  });

  it('should handle empty span lists gracefully', () => {
    const summary = analyzeSpans([]);
    expect(summary.totalSpans).toBe(0);
    expect(summary.services_involved).toEqual([]);
    expect(summary.top5Errors).toEqual([]);
    expect(summary.top5Slowest).toEqual([]);
    expect(summary.rootSpan).toBeUndefined();
    expect(summary.criticalSpan).toBeUndefined();
  });
});
