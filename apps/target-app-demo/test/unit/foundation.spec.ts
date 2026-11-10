import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chaosManager, ChaosManager } from '../../src/chaos/index.js';
import { CreatePaymentSchema } from '../../src/models/payment.model.js';
import { KnexTimeoutError } from '../../src/repositories/payment.repository.js';
import { initTelemetry, SpanStatusCode, telemetry } from '../../src/telemetry/otel.js';

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
      const metric = metrics.find((m) => m.name === 'http_server_duration');
      expect(metric).toBeDefined();
      expect(metric?.value).toBe(0.125);
      expect(metric?.exemplar?.traceId).toBe(traceId);
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
