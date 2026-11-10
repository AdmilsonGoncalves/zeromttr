import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { chaosManager } from '../../src/chaos/index.js';
import { paymentRepository } from '../../src/repositories/payment.repository.js';
import {
  createTestServer,
  makeRequest,
  postPayment,
  getPayment,
  toggleChaos,
  getChaosStatus,
  getHealth
} from '../helpers/http-test-client.js';

describe('target-app-demo routes integration', () => {
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
  });

  it('should return 200 with service name on /health', async () => {
    const res = await getHealth(server);
    expect(res.status).toBe(200);
    const body = res.body as { status: string; service: string; version: string; database: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api-pagamentos-core');
    expect(body.version).toBe('v2.14.7');
    expect(body.database).toBe('connected');
  });

  it('should return 200 plain text on root /', async () => {
    const res = await makeRequest(server, '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('ZeroMTTR Target Demo Workload Running');
  });

  it('should return 404 JSON for unknown routes', async () => {
    const res = await makeRequest(server, '/non-existent');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  describe('Payment API (/payments)', () => {
    it('should create a payment with 201 Created and return payment object', async () => {
      const payload = {
        amount: 250.75,
        currency: 'BRL',
        payerCpf: '123.456.789-00',
        merchantCnpj: '12.345.678/0001-99',
        pixKey: 'lojista@comercio.com.br',
        description: 'Venda PIX Integração'
      };

      const res = await postPayment(server, payload);
      expect(res.status).toBe(201);
      const payment = res.body as {
        id: string;
        txId: string;
        amount: number;
        currency: string;
        status: string;
        payerCpf: string;
        merchantCnpj: string;
        pixKey: string;
      };

      expect(payment.id).toBeDefined();
      expect(payment.txId).toMatch(/^TX-\d{4}$/);
      expect(payment.amount).toBe(250.75);
      expect(payment.currency).toBe('BRL');
      expect(payment.status).toBe('completed');
      expect(payment.payerCpf).toBe('123.456.789-00');

      // Now query via GET /payments/:id
      const queryRes = await getPayment(server, payment.id);
      expect(queryRes.status).toBe(200);
      expect(queryRes.body).toEqual(payment);
    });

    it('should return 400 Bad Request when payment payload is invalid', async () => {
      const invalidPayload = {
        amount: -50, // invalid negative amount
        payerCpf: '123' // too short
      };

      const res = await postPayment(server, invalidPayload);
      expect(res.status).toBe(400);
      const body = res.body as { error: string; details: unknown[] };
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('should return 404 Not Found for non-existent payment ID', async () => {
      const res = await getPayment(server, '00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Payment not found' });
    });
  });

  describe('Chaos API (/chaos)', () => {
    it('should toggle pool saturation on and off', async () => {
      const enableRes = await toggleChaos(server, true);
      expect(enableRes.status).toBe(200);
      expect(enableRes.body).toMatchObject({
        success: true,
        poolSaturation: true,
        status: { status: 'degraded', version: 'v2.14.8' }
      });

      const disableRes = await toggleChaos(server, false);
      expect(disableRes.status).toBe(200);
      expect(disableRes.body).toMatchObject({
        success: true,
        poolSaturation: false,
        status: { status: 'healthy', version: 'v2.14.7' }
      });
    });

    it('should return complete status on GET /chaos/status', async () => {
      const res = await getChaosStatus(server);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'healthy',
        service: 'api-pagamentos-core',
        version: 'v2.14.7',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        rawEdgeLogPreCollector:
          'ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
      });
    });
  });
});
