import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chaosManager, ChaosManager } from '../../src/chaos/index.js';
import { CreatePaymentSchema } from '../../src/models/payment.model.js';
import { KnexTimeoutError } from '../../src/repositories/payment.repository.js';
import {
  initTelemetry,
  SpanStatusCode,
  telemetry,
  TelemetryService
} from '../../src/telemetry/otel.js';

describe('target-app-demo foundation unit tests', () => {
  beforeEach(() => {
    chaosManager.reset();
    telemetry.clear();
  });

  describe('Telemetry & Observability', () => {
    it('should initialize telemetry and return singleton', () => {
      const tel = initTelemetry();
      expect(tel).toBeDefined();
      expect(tel.getServiceName()).toBe('api-pagamentos-core');
    });

    it('should generate valid 32-hex traceId and 16-hex spanId', () => {
      const traceId = telemetry.generateTraceId();
      const spanId = telemetry.generateSpanId();

      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should track spans with startSpan and endSpan', () => {
      const span = telemetry.startSpan('unit-test-span');
      expect(span.name).toBe('unit-test-span');
      expect(span.status.code).toBe(SpanStatusCode.UNSET);

      telemetry.endSpan(span, { code: SpanStatusCode.OK });
      expect(span.status.code).toBe(SpanStatusCode.OK);
      expect(span.endTime).toBeDefined();

      const spans = telemetry.getSpans();
      expect(spans).toContain(span);
    });

    it('should record metric exemplars containing traceId', () => {
      const traceId = telemetry.generateTraceId();
      telemetry.recordHttpServerDuration(0.125, traceId);

      const metrics = telemetry.getMetrics();
      const serverDuration = metrics.find((m) => m.name === 'http_server_duration');
      const reqDuration = metrics.find((m) => m.name === 'http_request_duration_seconds');
      expect(serverDuration).toBeDefined();
      expect(serverDuration?.value).toBe(0.125);
      expect(serverDuration?.exemplar?.traceId).toBe(traceId);
      expect(reqDuration).toBeDefined();
      expect(reqDuration?.value).toBe(0.125);
      expect(reqDuration?.exemplar?.traceId).toBe(traceId);
    });

    it('should enforce bounded buffer limits and discard oldest records', () => {
      // Push 5005 spans to test bounded buffer capacity
      for (let i = 0; i < 5005; i++) {
        const s = telemetry.startSpan(`span-${i}`);
        telemetry.endSpan(s);
      }
      const spans = telemetry.getSpans();
      expect(spans.length).toBe(5000);
      expect(spans[0].name).toBe('span-5');
      expect(spans[spans.length - 1].name).toBe('span-5004');
    });

    it('should record pool metrics db_pool_waiting and db_pool_used', () => {
      telemetry.recordPoolWaiting(3);
      telemetry.recordPoolUsed(7);

      const metrics = telemetry.getMetrics();
      const waiting = metrics.find((m) => m.name === 'db_pool_waiting');
      const used = metrics.find((m) => m.name === 'db_pool_used');

      expect(waiting?.value).toBe(3);
      expect(used?.value).toBe(7);
    });

    it('should coalesce same-millisecond histogram observations and preserve order', async () => {
      const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector.local:4318';
      const capturedBodies: unknown[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: unknown, init?: { body?: string }) => {
          if (init?.body) {
            capturedBodies.push(JSON.parse(init.body));
          }
          return { ok: true, status: 200 };
        })
      );

      try {
        const otlpTelemetry = new TelemetryService();
        const trace1 = '11111111111111111111111111111111';
        const trace2 = '22222222222222222222222222222222';
        const trace3 = '33333333333333333333333333333333';

        // Two observations in the same millisecond coalesce into one snapshot
        otlpTelemetry.recordHttpServerDuration(0.03, trace1);
        otlpTelemetry.recordHttpServerDuration(4.5, trace2);

        await new Promise((resolve) => setTimeout(resolve, 15));

        // Subsequent observation in a later millisecond emits an ordered cumulative snapshot
        otlpTelemetry.recordHttpServerDuration(0.2, trace3);
        await new Promise((resolve) => setTimeout(resolve, 15));

        const metricPayloads = capturedBodies.filter(
          (
            body
          ): body is {
            resourceMetrics: Array<{
              scopeMetrics: Array<{
                metrics: Array<{
                  name: string;
                  histogram?: {
                    aggregationTemporality: number;
                    dataPoints: Array<{
                      timeUnixNano: string;
                      count: string;
                      sum: number;
                      bucketCounts: string[];
                      exemplars: Array<{ traceId: string }>;
                    }>;
                  };
                }>;
              }>;
            }>;
          } => {
            return Boolean((body as { resourceMetrics?: unknown }).resourceMetrics);
          }
        );

        const secondsExports = metricPayloads
          .map((p) => p.resourceMetrics[0].scopeMetrics[0].metrics[0])
          .filter((m) => m.name === 'http_request_duration_seconds');

        expect(secondsExports).toHaveLength(2);

        const first = secondsExports[0].histogram?.dataPoints[0];
        const second = secondsExports[1].histogram?.dataPoints[0];
        expect(secondsExports[0].histogram?.aggregationTemporality).toBe(2);
        expect(first?.count).toBe('2');
        expect(first?.sum).toBeCloseTo(4.53, 5);
        expect(first?.bucketCounts[0]).toBe('1');
        expect(first?.bucketCounts[6]).toBe('1');
        expect(first?.exemplars[0].traceId).toBe(trace2);

        expect(second?.count).toBe('3');
        expect(second?.sum).toBeCloseTo(4.73, 5);
        expect(second?.exemplars[0].traceId).toBe(trace3);
        expect(BigInt(second?.timeUnixNano ?? '0') > BigInt(first?.timeUnixNano ?? '0')).toBe(true);
      } finally {
        vi.unstubAllGlobals();
        if (prevEndpoint === undefined) {
          delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        } else {
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
        }
      }
    });

    it('should serialize in-flight histogram exports and reuse captured resource', async () => {
      const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector.local:4318';
      const requests: Array<{ body: unknown; resolve: () => void }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: unknown, init?: { body?: string }) => {
          return new Promise<{ ok: boolean; status: number }>((res) => {
            requests.push({
              body: init?.body ? JSON.parse(init.body) : null,
              resolve: () => res({ ok: true, status: 200 })
            });
          });
        })
      );

      try {
        chaosManager.setPoolSaturation(true);
        const otlpTelemetry = new TelemetryService();
        const trace1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const trace2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

        otlpTelemetry.recordHttpServerDuration(0.1, trace1);
        await new Promise((resolve) => setTimeout(resolve, 15));

        const secondsFirst = requests.filter((r) => {
          const body = r.body as {
            resourceMetrics?: Array<{
              scopeMetrics?: Array<{ metrics?: Array<{ name: string }> }>;
            }>;
          };
          return (
            body?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.name ===
            'http_request_duration_seconds'
          );
        });
        expect(secondsFirst).toHaveLength(1);

        // Second observation for the same series arrives while first POST is still in flight
        otlpTelemetry.recordHttpServerDuration(0.4, trace2);
        // Flip chaos before flushing the pending snapshot to prove captured resource is reused
        chaosManager.setPoolSaturation(false);
        await new Promise((resolve) => setTimeout(resolve, 15));

        // Still only 1 in-flight request while first has not resolved
        const secondsStillInFlight = requests.filter((r) => {
          const body = r.body as {
            resourceMetrics?: Array<{
              scopeMetrics?: Array<{ metrics?: Array<{ name: string }> }>;
            }>;
          };
          return (
            body?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.name ===
            'http_request_duration_seconds'
          );
        });
        expect(secondsStillInFlight).toHaveLength(1);

        for (const req of requests) {
          req.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 25));

        const secondsAll = requests.filter((r) => {
          const body = r.body as {
            resourceMetrics?: Array<{
              scopeMetrics?: Array<{ metrics?: Array<{ name: string }> }>;
            }>;
          };
          return (
            body?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.name ===
            'http_request_duration_seconds'
          );
        });
        expect(secondsAll.length).toBeGreaterThanOrEqual(2);

        const secondBody = secondsAll[1].body as {
          resourceMetrics: Array<{
            resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
            scopeMetrics: Array<{
              metrics: Array<{
                histogram: { dataPoints: Array<{ count: string }> };
              }>;
            }>;
          }>;
        };
        const versionAttr = secondBody.resourceMetrics[0].resource.attributes.find(
          (a) => a.key === 'service.version'
        );
        expect(versionAttr?.value.stringValue).toBe('v2.14.8');
        expect(
          secondBody.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0].count
        ).toBe('2');
      } finally {
        vi.unstubAllGlobals();
        if (prevEndpoint === undefined) {
          delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        } else {
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
        }
      }
    });

    it('should record logs with trace and severity context', () => {
      const traceId = telemetry.generateTraceId();
      telemetry.emitLog('WARN', 'Sample warning log', { traceId });

      const logs = telemetry.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].severityText).toBe('WARN');
      expect(logs[0].traceId).toBe(traceId);
      expect(logs[0].body).toBe('Sample warning log');
    });
  });

  describe('Chaos Manager', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should start with healthy defaults when CHAOS_ENABLED is unset', () => {
      vi.stubEnv('CHAOS_ENABLED', '');
      const cm = new ChaosManager();
      expect(cm.isPoolSaturationEnabled()).toBe(false);
      expect(cm.getStatus().status).toBe('healthy');
      expect(cm.getStatus().version).toBe('v2.14.7');
    });

    it('should initialize with degraded state when CHAOS_ENABLED=true', () => {
      vi.stubEnv('CHAOS_ENABLED', 'true');
      const cm = new ChaosManager();
      expect(cm.isPoolSaturationEnabled()).toBe(true);
      expect(cm.getStatus().status).toBe('degraded');
      expect(cm.getStatus().version).toBe('v2.14.8');
    });

    it('should update status when pool saturation is enabled', () => {
      vi.stubEnv('CHAOS_ENABLED', '');
      const cm = new ChaosManager();
      cm.setPoolSaturation(true);
      expect(cm.isPoolSaturationEnabled()).toBe(true);
      expect(cm.getStatus().status).toBe('degraded');
      expect(cm.getStatus().version).toBe('v2.14.8');
    });

    it('should clamp delayMs to valid boundaries', () => {
      const cm = new ChaosManager();
      cm.setPoolSaturation(true, -100);
      expect(cm.getArtificialDelayMs()).toBe(4600);

      cm.setPoolSaturation(true, 1500);
      expect(cm.getArtificialDelayMs()).toBe(1500);
    });
  });

  describe('Error Classes & Models', () => {
    it('should construct KnexTimeoutError with correct name and message', () => {
      const err = new KnexTimeoutError();
      expect(err.name).toBe('KnexTimeoutError');
      expect(err.message).toContain('Knex: Timeout acquiring a connection');
    });

    it('should validate payment input using CreatePaymentSchema', () => {
      const valid = {
        amount: 100,
        payerCpf: '12345678901',
        merchantCnpj: '12345678000199',
        pixKey: 'test@example.com'
      };

      const result = CreatePaymentSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe('BRL');
        expect(result.data.description).toBe('PIX Payment Transaction');
      }

      const validFormatted = {
        amount: 50.25,
        payerCpf: '123.456.789-00',
        merchantCnpj: '12.345.678/0001-99',
        pixKey: 'lojista@comercio.com.br'
      };
      expect(CreatePaymentSchema.safeParse(validFormatted).success).toBe(true);
    });

    it('should reject invalid payment input', () => {
      const invalid = {
        amount: -10,
        payerCpf: '1234567890a',
        merchantCnpj: '123'
      };

      const result = CreatePaymentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
