import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, SseEventBroadcaster } from '../../src/http/index.js';
import { IncidentState, Incident, DecisionHmac } from '../../src/domain/index.js';
import type {
  IncidentRepository,
  TargetStatusPort,
  Clock,
  ToolsPort
} from '../../src/ports/index.js';
import {
  RecordDecision,
  type HandleAlert,
  type OrchestratorWorkflow
} from '../../src/application/index.js';

describe('Incident API Security & HMAC Decision Isolation (Acceptance Criterion 2 & 5)', () => {
  const DASHBOARD_TOKEN = 'test-dashboard-api-token-789';
  const HMAC_SECRET = 'test-hmac-secret-zeromttr-2026';
  const incidentId = 'inc-sec-001';
  const now = 1730000000;
  const exp = now + 900;

  const incident = new Incident({
    id: incidentId,
    service: 'api-pagamentos-core',
    severity: 'critical',
    fingerprint: 'alert:service',
    state: IncidentState.NOTIFIED,
    rca: {
      summary: 'Connection pool saturation',
      rootCause: 'Omission of client.release() in v2.14.8',
      reasoningSource: 'llm',
      evidenceCoveragePercent: 100,
      signalsCollected: 4,
      signalsTotal: 4,
      blastRadius: ['api-pagamentos-core'],
      diagnosisSeconds: 4,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      criticalSpan: 'pg.pool.acquire',
      spans: [],
      logSample: 'sample',
      piiGuardAudit: {
        leakedPatternsDetected: 0,
        detectedTypes: [],
        edgeRedactedTokensVerified: 4,
        passed: true
      },
      mitigations: ['Release client in finally']
    },
    remediation: {
      branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-demo',
      pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/10',
      commitSha: 'commit123456'
    }
  });

  const repo: IncidentRepository = {
    findById: vi.fn(async (id: string) => (id === incidentId ? incident : null)),
    findOpenByFingerprint: vi.fn(async () => null),
    findAll: vi.fn(async () => [incident]),
    save: vi.fn(async () => {})
  };

  const targetStatusPort: TargetStatusPort = {
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

  const toolsPort: ToolsPort = {
    executePromqlRange: vi.fn(),
    queryLokiLogs: vi.fn(),
    analyzeOtelTrace: vi.fn(),
    searchTracesByTraceQL: vi.fn(),
    inspectGitDeployDiff: vi.fn(),
    createRemediationPr: vi.fn(),
    sendPostMortemResend: vi.fn(),
    annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 301, success: true }))
  };

  const clock: Clock = {
    now: () => now * 1000,
    iso: () => '2026-11-10T12:00:00.000Z'
  };

  const broadcaster = new SseEventBroadcaster();
  const recordDecision = new RecordDecision(repo, toolsPort, clock, broadcaster, HMAC_SECRET);

  let originalLiveDemoKey: string | undefined;
  let app: Express;

  beforeAll(() => {
    originalLiveDemoKey = process.env.LIVE_DEMO_KEY;
    delete process.env.LIVE_DEMO_KEY;

    app = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: {} as HandleAlert,
      orchestratorWorkflow: {} as OrchestratorWorkflow,
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN
    });
  });

  afterAll(() => {
    if (originalLiveDemoKey !== undefined) {
      process.env.LIVE_DEMO_KEY = originalLiveDemoKey;
    } else {
      delete process.env.LIVE_DEMO_KEY;
    }
    broadcaster.close();
  });

  it('should reject GET /api/incidents when missing token with 401', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(401);
  });

  it('should return incidents list when DASHBOARD_API_TOKEN is provided', async () => {
    const res = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body[0].id).toBe(incidentId);
  });

  it('should return IncidentDetail on GET /api/incidents/:id without leaking approveSig or rejectSig', async () => {
    const res = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(incidentId);
    expect(res.body.rca?.reasoningSource).toBe('llm');

    // CRITICAL SECURITY ASSERTIONS
    expect(res.body.approveSig).toBeUndefined();
    expect(res.body.rejectSig).toBeUndefined();
    expect(res.body.sig).toBeUndefined();

    const rawString = JSON.stringify(res.body);
    expect(rawString).not.toContain('approveSig');
    expect(rawString).not.toContain('rejectSig');
  });

  it('should validate signed decision POST /api/incidents/:id/decision and transition state', async () => {
    const sig = DecisionHmac.sign(incidentId, 'approve', exp, HMAC_SECRET);

    const res = await request(app)
      .post(`/api/incidents/${incidentId}/decision`)
      .send({ action: 'approve', sig, exp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.state).toBe(IncidentState.RESOLVED);
    expect(res.body.decision).toBe('approve');
    expect(res.body.decisionSource).toBe('email_hmac');
  });

  it('should reject a second decision attempt on an already RESOLVED incident with 409 Conflict', async () => {
    const resolvedIncident = new Incident({
      id: 'inc-already-resolved',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service:resolved',
      state: IncidentState.RESOLVED
    });
    vi.spyOn(repo, 'findById').mockResolvedValueOnce(resolvedIncident);

    const sig = DecisionHmac.sign('inc-already-resolved', 'approve', exp, HMAC_SECRET);

    const res = await request(app)
      .post('/api/incidents/inc-already-resolved/decision')
      .send({ action: 'approve', sig, exp });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already');
  });

  it('should reject invalid or tampered HMAC signature with 403 Forbidden', async () => {
    const otherIncident = new Incident({
      id: 'inc-other',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service:2',
      state: IncidentState.NOTIFIED
    });
    vi.spyOn(repo, 'findById').mockResolvedValueOnce(otherIncident);

    const res = await request(app)
      .post('/api/incidents/inc-other/decision')
      .send({ action: 'approve', sig: 'invalid-hex-signature-0000', exp });

    expect(res.status).toBe(403);
  });

  it('should reject invalid decision payload with 400 and Zod details', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/decision`)
      .send({ action: 'invalid-action', sig: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid decision payload');
    expect(res.body.details).toBeDefined();
  });

  it('should reject invalid simulate-decision payload with 400 and Zod details', async () => {
    const res = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ action: 'invalid-action' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid simulate decision payload');
    expect(res.body.details).toBeDefined();
  });

  it('should reject demo endpoints with 403 when LIVE_DEMO_KEY is configured and header is missing', async () => {
    const protectedApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: {} as HandleAlert,
      orchestratorWorkflow: {} as OrchestratorWorkflow,
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      liveDemoKey: 'secret-demo-key-123'
    });

    const res = await request(protectedApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: 'replay' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('X-Live-Demo-Key');

    // Should succeed with valid key
    const successRes = await request(protectedApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-demo-key-123')
      .send({ mode: 'replay' });

    expect(successRes.status).toBe(202);
  });

  it('should enforce cooldown on /api/demo/chaos with 429 Too Many Requests', async () => {
    const cooldownApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: {} as HandleAlert,
      orchestratorWorkflow: {} as OrchestratorWorkflow,
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoCooldownMs: 5000
    });

    const firstRes = await request(cooldownApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: 'replay' });

    expect(firstRes.status).toBe(202);

    const secondRes = await request(cooldownApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: 'replay' });

    expect(secondRes.status).toBe(429);
    expect(secondRes.body.error).toContain('cooldown');
    expect(secondRes.body.retryAfterSeconds).toBeGreaterThan(0);
  });
});
