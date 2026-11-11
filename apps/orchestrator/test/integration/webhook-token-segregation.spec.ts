import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/index.js';
import type { IncidentRepository, TargetStatusPort } from '../../src/ports/index.js';
import { HandleAlert, OrchestratorWorkflow, RecordDecision } from '../../src/application/index.js';

describe('Webhook Token Segregation (Acceptance Criterion 1)', () => {
  const GRAFANA_TOKEN = 'secret-grafana-webhook-token-123';
  const DASHBOARD_TOKEN = 'secret-dashboard-api-token-456';

  const mockRepo: IncidentRepository = {
    findById: vi.fn(async () => null),
    findOpenByFingerprint: vi.fn(async () => null),
    findAll: vi.fn(async () => []),
    save: vi.fn(async () => {})
  };

  const mockTargetStatus: TargetStatusPort = {
    getStatus: vi.fn(async () => ({
      status: 'healthy' as const,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: 'raw'
    })),
    triggerChaos: vi.fn(),
    reset: vi.fn()
  };

  const mockBroadcaster = { broadcast: vi.fn() };
  const handleAlert = new HandleAlert(mockRepo, mockBroadcaster);
  const mockWorkflow = {
    runFullPipeline: vi.fn(async () => {})
  } as unknown as OrchestratorWorkflow;
  const mockRecordDecision = {} as unknown as RecordDecision;

  const app = createApp({
    repository: mockRepo,
    targetStatusPort: mockTargetStatus,
    handleAlert,
    orchestratorWorkflow: mockWorkflow,
    recordDecision: mockRecordDecision,
    grafanaWebhookToken: GRAFANA_TOKEN,
    dashboardApiToken: DASHBOARD_TOKEN
  });

  const validPayload = {
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'PaymentServicePoolExhaustion',
          service: 'api-pagamentos-core',
          severity: 'critical'
        }
      }
    ]
  };

  it('should reject request without authorization header with 401', async () => {
    const res = await request(app).post('/webhook/grafana-alert').send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing Grafana webhook authorization token');
  });

  it('should explicitly reject requests using DASHBOARD_API_TOKEN with 403 Forbidden', async () => {
    const res = await request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('DASHBOARD_API_TOKEN is not authorized');
  });

  it('should reject requests with invalid token with 401', async () => {
    const res = await request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', 'Bearer invalid-token')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid Grafana webhook authorization token');
  });

  it('should accept requests using the dedicated GRAFANA_WEBHOOK_TOKEN with 202 Accepted', async () => {
    const res = await request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', `Bearer ${GRAFANA_TOKEN}`)
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.incidentId).toBeDefined();
    expect(mockWorkflow.runFullPipeline).toHaveBeenCalled();
  });
});
