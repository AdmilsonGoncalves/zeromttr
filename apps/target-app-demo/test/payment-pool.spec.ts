import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { chaosManager } from '../src/chaos/index.js';
import { paymentRepository, KnexTimeoutError } from '../src/repositories/payment.repository.js';
import { SpanStatusCode, telemetry } from '../src/telemetry/otel.js';
import {
  createTestServer,
  postPayment,
  toggleChaos,
  getChaosStatus
} from './helpers/http-test-client.js';

describe('PaymentRepository Pool & Regression Suite (v2.14.7 vs v2.14.8)', () => {
  let server: http.Server;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const testServer = await createTestServer();
    server = testServer.server;
    closeServer = testServer.close;
  });

  afterAll(async () => {
    chaosManager.reset();
    paymentRepository.resetPool();
    await closeServer();
  });

  beforeEach(() => {
    chaosManager.reset();
    paymentRepository.resetPool();
    telemetry.clear();
  });

  const validPaymentPayload = {
    amount: 150.5,
    currency: 'BRL',
    payerCpf: '123.456.789-00',
    merchantCnpj: '12.345.678/0001-99',
    pixKey: 'cliente.silva@exemplo.com.br',
    description: 'Pagamento PIX Demonstração ZeroMTTR',
    authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
  };

  describe('Healthy Pool Behavior (Release v2.14.7 Baseline)', () => {
    it('should process concurrent PIX transactions and release connections strictly in finally block', async () => {
      // Execute 8 concurrent requests
      const promises = Array.from({ length: 8 }).map(() =>
        postPayment(server, validPaymentPayload)
      );

      const responses = await Promise.all(promises);

      for (const res of responses) {
        expect(res.status).toBe(201);
        const body = res.body as { id: string; status: string; txId: string };
        expect(body.status).toBe('completed');
        expect(body.id).toBeDefined();
        expect(body.txId).toMatch(/^TX-\d{4}$/);
      }

      // Check pool release: all connections released back to pool
      const poolStats = paymentRepository.getPoolStats();
      expect(poolStats.active).toBe(0);
      expect(poolStats.waiting).toBe(0);
      expect(poolStats.max).toBe(10);

      // Verify traces and metrics
      const spans = telemetry.getSpans();
      expect(spans.length).toBeGreaterThan(0);
      const errorSpans = spans.filter((s) => s.status.code === SpanStatusCode.ERROR);
      expect(errorSpans.length).toBe(0);

      const metrics = telemetry.getMetrics();
      const serverDurationMetrics = metrics.filter((m) => m.name === 'http_server_duration');
      expect(serverDurationMetrics.length).toBe(8);
      expect(serverDurationMetrics[0].exemplar?.traceId).toBeDefined();
    });

    it('should report healthy status with version v2.14.7 when chaos is disabled', async () => {
      const res = await getChaosStatus(server);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'healthy',
        service: 'api-pagamentos-core',
        version: 'v2.14.7',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        rawEdgeLogPreCollector: expect.stringContaining(
          'ERROR [api-pagamentos-core] Pool exhausted'
        )
      });
    });
  });

  describe('Degraded Pool Behavior (Regression Simulation v2.14.8 with Chaos Enabled)', () => {
    it('should trigger KnexTimeoutError and saturate pool due to unreleased connections', async () => {
      // Activate pool saturation chaos
      const toggleRes = await toggleChaos(server, true);
      expect(toggleRes.status).toBe(200);

      // Verify chaos status
      const statusRes = await getChaosStatus(server);
      const statusBody = statusRes.body as { status: string; version: string };
      expect(statusBody.status).toBe('degraded');
      expect(statusBody.version).toBe('v2.14.8');

      // In degraded mode, pool is reduced to 2 and connections are leaked!
      // Send 2 requests to leak the 2 connections
      await postPayment(server, validPaymentPayload);
      await postPayment(server, validPaymentPayload);

      // 3rd and subsequent requests will encounter an exhausted pool and throw KnexTimeoutError
      const saturatedRes = await postPayment(server, validPaymentPayload);
      expect(saturatedRes.status).toBe(503);
      const errorBody = saturatedRes.body as { code: string; error: string; service: string };
      expect(errorBody.code).toBe('KnexTimeoutError');
      expect(errorBody.error).toContain('Timeout acquiring a connection');

      // Verify telemetry: Span error recorded
      const spans = telemetry.getSpans();
      const errorSpans = spans.filter((s) => s.status.code === SpanStatusCode.ERROR);
      expect(errorSpans.length).toBeGreaterThan(0);
      const poolAcquireSpan = errorSpans.find((s) => s.name === 'pg.pool.acquire');
      expect(poolAcquireSpan).toBeDefined();
      expect(poolAcquireSpan?.status.message).toContain('Timeout acquiring a connection');

      // Verify telemetry: Structured log contains synthetic Brazilian PII matching OTTL masking
      const logs = telemetry.getLogs();
      const errorLogs = logs.filter((l) => l.severityText === 'ERROR');
      expect(errorLogs.length).toBeGreaterThan(0);

      const latestErrorLog = errorLogs[errorLogs.length - 1];
      expect(latestErrorLog.traceId).toBeDefined();
      expect(latestErrorLog.body).toContain('123.456.789-00');
      expect(latestErrorLog.body).toContain('12.345.678/0001-99');
      expect(latestErrorLog.body).toContain('cliente.silva@exemplo.com.br');
      expect(latestErrorLog.body).toContain('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    });

    it('should directly throw KnexTimeoutError when calling repository with exhausted pool', async () => {
      chaosManager.setPoolSaturation(true);

      // Saturate degraded pool (max 2)
      await paymentRepository.createPayment(validPaymentPayload);
      await paymentRepository.createPayment(validPaymentPayload);

      // 3rd call must fail with KnexTimeoutError
      await expect(paymentRepository.createPayment(validPaymentPayload)).rejects.toThrow(
        KnexTimeoutError
      );
    });
  });

  describe('Restoration and Recovery Behavior', () => {
    it('should reject pending connection waiters when resetPool is called', async () => {
      chaosManager.setPoolSaturation(true);

      // Saturate pool
      await paymentRepository.createPayment(validPaymentPayload);
      await paymentRepository.createPayment(validPaymentPayload);

      // Start a 3rd request that will wait in queue
      const waitingPromise = paymentRepository.createPayment(validPaymentPayload);

      // Reset pool while request is waiting
      paymentRepository.resetPool();

      // Waiting promise must reject with cancellation error
      await expect(waitingPromise).rejects.toThrow('Connection pool was reset');
    });

    it('should recover completely when chaos is disabled and pool is reset', async () => {
      // Degrade first
      await toggleChaos(server, true);
      await postPayment(server, validPaymentPayload);
      await postPayment(server, validPaymentPayload);
      const failRes = await postPayment(server, validPaymentPayload);
      expect(failRes.status).toBe(503);

      // Disable chaos
      const resetRes = await toggleChaos(server, false);
      expect(resetRes.status).toBe(200);

      // Verify status is healthy again
      const statusRes = await getChaosStatus(server);
      const statusBody = statusRes.body as { status: string; version: string };
      expect(statusBody.status).toBe('healthy');
      expect(statusBody.version).toBe('v2.14.7');

      // New payments must succeed immediately
      const recoveredRes = await postPayment(server, validPaymentPayload);
      expect(recoveredRes.status).toBe(201);
      const body = recoveredRes.body as { status: string };
      expect(body.status).toBe('completed');
    });
  });
});
