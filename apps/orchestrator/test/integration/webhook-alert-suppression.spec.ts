import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { TargetHealthStatus } from '../../src/domain/incident-enums.js';
import { IncidentState } from '../../src/domain/incident-state.js';
import { Incident } from '../../src/domain/incident.js';
import type { IncidentRepository } from '../../src/ports/incident-repository.port.js';
import type { TargetStatusPort } from '../../src/ports/target-status.port.js';
import { HandleAlert } from '../../src/application/handle-alert.js';
import { createStubRecordDecision, createStubWorkflow } from '../helpers/test-doubles.helper.js';

describe('Grafana webhook alert suppression response contract', () => {
  const GRAFANA_TOKEN = 'synthetic-grafana-webhook-token-789';
  const DASHBOARD_TOKEN = 'synthetic-dashboard-api-token-012';
  const REPEAT_SUPPRESSION_SECONDS = 900;
  const REJECTION_COOLDOWN_SECONDS = 120;

  const firingPayload = {
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

  const mockTargetStatus: TargetStatusPort = {
    getStatus: vi.fn(async () => ({
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: 'raw'
    }))
  };

  const buildApp = (latestIncident: Incident | null) => {
    const repository: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findLatestByFingerprint: vi.fn(async () => latestIncident),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };
    const broadcaster = { broadcast: vi.fn() };
    const handleAlert = new HandleAlert(repository, broadcaster, () => ({
      rejectionCooldownSeconds: REJECTION_COOLDOWN_SECONDS,
      repeatSuppressionSeconds: REPEAT_SUPPRESSION_SECONDS,
      decisionTtlSeconds: 600
    }));
    const workflow = createStubWorkflow();
    const app = createApp({
      repository,
      targetStatusPort: mockTargetStatus,
      handleAlert,
      orchestratorWorkflow: workflow,
      recordDecision: createStubRecordDecision(repository),
      grafanaWebhookToken: GRAFANA_TOKEN,
      dashboardApiToken: DASHBOARD_TOKEN
    });
    return { app, workflow, broadcaster, handleAlert };
  };

  const postAlert = (app: ReturnType<typeof buildApp>['app']) =>
    request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', `Bearer ${GRAFANA_TOKEN}`)
      .send(firingPayload);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const buildConcludedIncident = (state: IncidentState): Incident =>
    new Incident({
      id: 'inc-concluded-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state
    });

  it.each([
    {
      state: IncidentState.RESOLVED,
      reason: 'repeat_suppression',
      windowSeconds: REPEAT_SUPPRESSION_SECONDS
    },
    {
      state: IncidentState.REJECTED,
      reason: 'rejection_cooldown',
      windowSeconds: REJECTION_COOLDOWN_SECONDS
    }
  ])(
    'should_return_suppression_fields_when_alert_repeats_after_$state_incident',
    async ({ state, reason, windowSeconds }) => {
      const { app, workflow, broadcaster } = buildApp(buildConcludedIncident(state));

      const res = await postAlert(app);

      expect(res.status).toBe(202);
      expect(res.body).toEqual(
        expect.objectContaining({
          status: 'accepted',
          incidentId: 'inc-concluded-001',
          isDuplicate: true,
          suppressed: true,
          suppressionReason: reason,
          windowSeconds
        })
      );
      expect(res.body.remainingSeconds).toBeGreaterThan(0);
      expect(res.body.remainingSeconds).toBeLessThanOrEqual(windowSeconds);
      expect(workflow.runFullPipeline).not.toHaveBeenCalled();
      expect(broadcaster.broadcast).toHaveBeenCalledWith(
        'alert.suppressed',
        expect.objectContaining({ incidentId: 'inc-concluded-001', reason })
      );
    }
  );

  it('should_propagate_suppression_fields_to_concurrent_alerts_with_same_fingerprint', async () => {
    const { handleAlert } = buildApp(buildConcludedIncident(IncidentState.RESOLVED));

    const [first, second] = await Promise.all([
      handleAlert.execute(firingPayload),
      handleAlert.execute(firingPayload)
    ]);

    expect(first.suppressed).toBe(true);
    expect(second).toEqual(
      expect.objectContaining({
        isDuplicate: true,
        suppressed: true,
        suppressionReason: 'repeat_suppression',
        remainingSeconds: first.remainingSeconds,
        windowSeconds: REPEAT_SUPPRESSION_SECONDS
      })
    );
  });

  it('should_omit_suppression_fields_when_no_recent_conclusive_incident_exists', async () => {
    const { app, workflow } = buildApp(null);

    const res = await postAlert(app);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.isDuplicate).toBe(false);
    expect(res.body).not.toHaveProperty('suppressed');
    expect(res.body).not.toHaveProperty('suppressionReason');
    expect(res.body).not.toHaveProperty('remainingSeconds');
    expect(res.body).not.toHaveProperty('windowSeconds');
    await new Promise((resolve) => setImmediate(resolve));
    expect(workflow.runFullPipeline).toHaveBeenCalled();
  });
});
