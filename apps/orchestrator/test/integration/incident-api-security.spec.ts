import http from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { createApp } from '../../src/http/app.js';
import { SseEventBroadcaster } from '../../src/http/events.sse.js';
import {
  createDemoRouterFactory,
  createDemoSessionLifecycle
} from '../../src/demo/demo.controller.js';
import { SimulateDemoDecision } from '../../src/demo/simulate-demo-decision.js';
import type { DemoControlPort } from '../../src/demo/demo-control.port.js';
import {
  AlertSeverity,
  DecisionAction,
  DecisionSource,
  IncidentEventType,
  IncidentExecutionMode,
  TargetHealthStatus
} from '../../src/domain/incident-enums.js';
import { IncidentState } from '../../src/domain/incident-state.js';
import { Incident } from '../../src/domain/incident.js';
import { DecisionHmac } from '../../src/domain/decision-hmac.js';
import type { IncidentRepository } from '../../src/ports/incident-repository.port.js';
import type { TargetStatusPort } from '../../src/ports/target-status.port.js';
import type { Clock } from '../../src/ports/clock.port.js';
import type { ToolsPort } from '../../src/ports/tools.port.js';
import { RecordDecision } from '../../src/application/record-decision.js';
import { createStubHandleAlert, createStubWorkflow } from '../helpers/test-doubles.helper.js';

describe('Incident API Security & HMAC Decision Isolation (Acceptance Criterion 2 & 5)', () => {
  const DASHBOARD_TOKEN = 'test-dashboard-api-token-789';
  const HMAC_SECRET = 'test-hmac-secret-zeromttr-2026';
  const incidentId = 'inc-sec-001';
  const now = 1730000000;
  const exp = now + 900;

  const incident = new Incident({
    id: incidentId,
    service: 'api-pagamentos-core',
    severity: AlertSeverity.CRITICAL,
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
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: 'raw'
    }))
  };

  const demoControlPort: DemoControlPort = {
    triggerChaos: vi.fn(),
    toggleHealthyTraffic: vi.fn(),
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
  const simulateDemoDecision = new SimulateDemoDecision(repo, toolsPort, broadcaster);

  let originalLiveDemoKey: string | undefined;
  let app: Express;

  beforeAll(() => {
    originalLiveDemoKey = process.env.LIVE_DEMO_KEY;
    delete process.env.LIVE_DEMO_KEY;

    app = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        demoControlPort,
        simulateDemoDecision
      })
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
    // Generate a valid signature for 'reject', but submit it with 'approve' to simulate tampering
    const tamperedSig = DecisionHmac.sign('inc-sec-001', 'reject', exp, HMAC_SECRET);

    const res = await request(app)
      .post('/api/incidents/inc-sec-001/decision')
      .send({ action: 'approve', sig: tamperedSig, exp });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Invalid or expired decision HMAC signature');
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

  it('should allow replay mode without X-Live-Demo-Key while requiring it for live chaos, live reset, and live simulate-decision', async () => {
    const replayIncident = new Incident({
      id: 'inc-replay-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:replay',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.REPLAY
    });
    const liveIncident = new Incident({
      id: 'inc-live-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:live',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.LIVE
    });
    const localRepo: IncidentRepository = {
      findById: vi.fn(async (id: string) => {
        if (id === replayIncident.id) {
          return replayIncident;
        }
        if (id === liveIncident.id) {
          return liveIncident;
        }
        return null;
      }),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [replayIncident, liveIncident]),
      save: vi.fn(async () => {})
    };
    const localSimDecision = new SimulateDemoDecision(localRepo, toolsPort, broadcaster);

    const protectedApp = createApp({
      repository: localRepo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(localRepo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: localRepo,
        demoControlPort,
        simulateDemoDecision: localSimDecision,
        liveDemoKey: 'secret-demo-key-123',
        cooldownMs: 0
      })
    });

    // Replay chaos works without X-Live-Demo-Key
    const replayRes = await request(protectedApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });
    expect(replayRes.status).toBe(HTTP_STATUS.ACCEPTED);

    // Live chaos requires X-Live-Demo-Key
    const missingKeyLiveRes = await request(protectedApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(missingKeyLiveRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(missingKeyLiveRes.body.error).toContain('X-Live-Demo-Key');

    const validKeyLiveRes = await request(protectedApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-demo-key-123')
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(validKeyLiveRes.status).toBe(HTTP_STATUS.ACCEPTED);

    // Live reset requires X-Live-Demo-Key
    const missingKeyResetRes = await request(protectedApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(missingKeyResetRes.status).toBe(HTTP_STATUS.FORBIDDEN);

    // Use an empty findAll during the auth-matrix assertions so simulate-decision fixtures remain NOTIFIED,
    // then verify directly that /api/demo/reset marks open incidents as FAILED.
    vi.mocked(localRepo.findAll).mockResolvedValueOnce([]);
    const validKeyResetRes = await request(protectedApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-demo-key-123');
    expect(validKeyResetRes.status).toBe(HTTP_STATUS.ACCEPTED);

    // Simulate decision on REPLAY incident works without X-Live-Demo-Key
    const simReplayRes = await request(protectedApp)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(simReplayRes.status).toBe(HTTP_STATUS.OK);
    expect(simReplayRes.body).toMatchObject({
      success: true,
      simulated: true,
      incidentId: replayIncident.id,
      state: IncidentState.RESOLVED,
      decisionSource: DecisionSource.DEMO_SIMULATION
    });

    // Simulate decision on LIVE incident requires X-Live-Demo-Key
    const simLiveDeniedRes = await request(protectedApp)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: liveIncident.id, action: DecisionAction.REJECT });
    expect(simLiveDeniedRes.status).toBe(HTTP_STATUS.FORBIDDEN);

    const simLiveAllowedRes = await request(protectedApp)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-demo-key-123')
      .send({ incidentId: liveIncident.id, action: DecisionAction.REJECT });
    expect(simLiveAllowedRes.status).toBe(HTTP_STATUS.OK);
    expect(simLiveAllowedRes.body.state).toBe(IncidentState.REJECTED);

    // Reset closes remaining non-terminal incidents so subsequent Grafana alerts do not deduplicate
    expect(replayIncident.state).toBe(IncidentState.RESOLVED);
    const lingeringIncident = new Incident({
      id: 'inc-lingering-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:lingering',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.LIVE
    });
    vi.mocked(localRepo.findAll).mockResolvedValue([lingeringIncident]);
    const unauthorizedLiveResetRes = await request(protectedApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(unauthorizedLiveResetRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(lingeringIncident.state).toBe(IncidentState.NOTIFIED);

    const closingResetRes = await request(protectedApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-demo-key-123');
    expect(closingResetRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(lingeringIncident.state).toBe(IncidentState.FAILED);
    expect(localRepo.save).toHaveBeenCalledWith(lingeringIncident);
  });

  it('should fail closed on live demo actions when LIVE_DEMO_KEY is empty in production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const localRepo: IncidentRepository = {
        findById: vi.fn(async () => null),
        findOpenByFingerprint: vi.fn(async () => null),
        findAll: vi.fn(async () => []),
        save: vi.fn(async () => {})
      };
      const prodApp = createApp({
        repository: localRepo,
        targetStatusPort: { getStatus: vi.fn() },
        handleAlert: createStubHandleAlert(),
        orchestratorWorkflow: createStubWorkflow(),
        recordDecision: { execute: vi.fn() } as unknown as RecordDecision,
        broadcaster: new SseEventBroadcaster(60_000),
        grafanaWebhookToken: 'grafana-test-token',
        dashboardApiToken: DASHBOARD_TOKEN,
        demoRouter: createDemoRouterFactory({
          repository: localRepo,
          demoControlPort: { triggerChaos: vi.fn(), toggleHealthyTraffic: vi.fn(), reset: vi.fn() },
          simulateDemoDecision: { execute: vi.fn() } as unknown as SimulateDemoDecision,
          liveDemoKey: ''
        })
      });

      const res = await request(prodApp)
        .post('/api/demo/chaos')
        .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
        .send({ mode: IncidentExecutionMode.LIVE });
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('should stream SSE heartbeat and events on GET /api/events with query token', async () => {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP address');
      }

      const controller = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/events?token=${DASHBOARD_TOKEN}`,
        { signal: controller.signal }
      );
      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();

      const firstChunk = await reader!.read();
      const firstText = decoder.decode(firstChunk.value);
      expect(firstText).toContain('event: heartbeat');

      broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId,
        from: IncidentState.AWAITING_PR,
        to: IncidentState.NOTIFIED
      });

      const secondChunk = await reader!.read();
      const secondText = decoder.decode(secondChunk.value);
      expect(secondText).toContain(`event: ${IncidentEventType.TRANSITION}`);
      expect(secondText).toContain(incidentId);

      controller.abort();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('should return structured 400 JSON when receiving malformed JSON request body', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/decision`)
      .set('Content-Type', 'application/json')
      .send('{"action":');

    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.body).toEqual({ error: 'Malformed JSON request body' });
  });

  it('should enforce cooldown on /api/demo/chaos with 429 Too Many Requests', async () => {
    const cooldownApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        demoControlPort,
        simulateDemoDecision,
        cooldownMs: 5000
      })
    });

    const firstRes = await request(cooldownApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(firstRes.status).toBe(HTTP_STATUS.ACCEPTED);

    const secondRes = await request(cooldownApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(secondRes.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(secondRes.body.error).toContain('cooldown');
    expect(secondRes.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('should leave /api/demo/* unmounted (404) when demoRouter is omitted from core app', async () => {
    const coreOnlyApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN
    });

    const statusRes = await request(coreOnlyApp)
      .get('/api/target/status')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(statusRes.status).toBe(HTTP_STATUS.OK);

    const demoChaosRes = await request(coreOnlyApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });
    expect(demoChaosRes.status).toBe(HTTP_STATUS.NOT_FOUND);

    const simDecisionRes = await request(coreOnlyApp)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId, action: DecisionAction.APPROVE });
    expect(simDecisionRes.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('should reject invalid /api/demo/chaos payload with 400 and Zod details', async () => {
    const res = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: 'invalid-mode' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid demo chaos payload');
    expect(res.body.details).toBeDefined();
  });

  it('should reject query-string token on non-SSE routes even with /events in query or POST /api/events', async () => {
    const queryBypassRes = await request(app).get(
      `/api/incidents?filter=/events&token=${DASHBOARD_TOKEN}`
    );
    expect(queryBypassRes.status).toBe(401);

    const postEventsRes = await request(app).post(`/api/events?token=${DASHBOARD_TOKEN}`);
    expect(postEventsRes.status).toBe(401);
  });

  it('should_require_live_demo_key_and_delegate_healthy_traffic_toggle', async () => {
    const toggleHealthyTraffic = vi.fn(async () => {});
    const keyedApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      grafanaWebhookToken: 'grafana-test-token',
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: repo,
        demoControlPort: { triggerChaos: vi.fn(), toggleHealthyTraffic, reset: vi.fn() },
        simulateDemoDecision,
        liveDemoKey: 'live-secret-key'
      })
    });

    const unauthorizedRes = await request(keyedApp)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ enable: true });
    expect(unauthorizedRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(toggleHealthyTraffic).not.toHaveBeenCalled();

    const authorizedRes = await request(keyedApp)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'live-secret-key')
      .send({ enable: true });
    expect(authorizedRes.status).toBe(HTTP_STATUS.OK);
    expect(authorizedRes.body).toEqual({ success: true, healthyTrafficActive: true });
    expect(toggleHealthyTraffic).toHaveBeenCalledWith(true);
  });

  it('should_fail_closed_when_live_demo_key_is_empty_in_staging', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging';
    try {
      const stagingApp = createApp({
        repository: repo,
        targetStatusPort,
        handleAlert: createStubHandleAlert(repo),
        orchestratorWorkflow: createStubWorkflow(),
        recordDecision,
        broadcaster,
        grafanaWebhookToken: 'grafana-test-token',
        dashboardApiToken: DASHBOARD_TOKEN,
        demoRouter: createDemoRouterFactory({
          repository: repo,
          demoControlPort: { triggerChaos: vi.fn(), toggleHealthyTraffic: vi.fn(), reset: vi.fn() },
          simulateDemoDecision,
          liveDemoKey: ''
        })
      });

      const res = await request(stagingApp)
        .post('/api/demo/chaos')
        .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
        .send({ mode: IncidentExecutionMode.LIVE });
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('should invoke onIncidentApproved hook for live email approval without coupling record decision', async () => {
    const liveIncident = new Incident({
      id: 'inc-live-email-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:live-email',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.LIVE
    });
    const localRepo: IncidentRepository = {
      findById: vi.fn(async (id: string) => (id === liveIncident.id ? liveIncident : null)),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [liveIncident]),
      save: vi.fn(async () => {})
    };
    const localReset = vi.fn(async () => {});
    const onIncidentApproved = vi.fn(async (approved: Incident) => {
      if (approved.mode === IncidentExecutionMode.LIVE) {
        await localReset();
      }
    });
    const localRecordDecision = new RecordDecision(
      localRepo,
      toolsPort,
      clock,
      broadcaster,
      HMAC_SECRET,
      undefined,
      onIncidentApproved
    );
    const hookApp = createApp({
      repository: localRepo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(localRepo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: localRecordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN
    });

    const sig = DecisionHmac.sign(liveIncident.id, DecisionAction.APPROVE, exp, HMAC_SECRET);
    const res = await request(hookApp)
      .post(`/api/incidents/${liveIncident.id}/decision`)
      .send({ action: DecisionAction.APPROVE, sig, exp });

    expect(res.status).toBe(HTTP_STATUS.OK);
    expect(res.body.state).toBe(IncidentState.RESOLVED);
    expect(onIncidentApproved).toHaveBeenCalledWith(liveIncident);
    expect(localReset).toHaveBeenCalledTimes(1);
  });

  it('should reject live chaos and healthy traffic when target reports false capabilities', async () => {
    const triggerChaos = vi.fn(async () => {});
    const toggleHealthyTraffic = vi.fn(async () => {});
    const passiveTargetPort: TargetStatusPort = {
      getStatus: vi.fn(async () => ({
        status: TargetHealthStatus.HEALTHY,
        service: 'external-orders-api',
        version: 'v1.0.0',
        previousHealthyVersion: 'v0.9.9',
        targetRepo: 'https://github.com/org/external-orders-api',
        suspectFilePath: '',
        capabilities: {
          chaosSimulation: false,
          healthyTrafficToggle: false
        },
        rawEdgeLogPreCollector: ''
      }))
    };

    const passiveApp = createApp({
      repository: repo,
      targetStatusPort: passiveTargetPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: repo,
        targetStatusPort: passiveTargetPort,
        demoControlPort: { triggerChaos, toggleHealthyTraffic, reset: vi.fn() },
        simulateDemoDecision
      })
    });

    const chaosRes = await request(passiveApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(chaosRes.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(chaosRes.body.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(triggerChaos).not.toHaveBeenCalled();

    const trafficRes = await request(passiveApp)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ enable: true });
    expect(trafficRes.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(trafficRes.body.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(toggleHealthyTraffic).not.toHaveBeenCalled();
  });

  it('should_preserve_live_reset_authorization_when_demo_reset_fails_transiently', async () => {
    const liveIncident = new Incident({
      id: 'inc-live-reset-retry-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:live-reset-retry',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.LIVE
    });
    const storedIncidents = [liveIncident];
    const localRepo: IncidentRepository = {
      findById: vi.fn(async (id: string) => storedIncidents.find((i) => i.id === id) ?? null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => storedIncidents),
      save: vi.fn(async () => {})
    };
    const resetMock = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('target unreachable'))
      .mockResolvedValueOnce(undefined);

    const retryApp = createApp({
      repository: localRepo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(localRepo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: localRepo,
        demoControlPort: { triggerChaos: vi.fn(), toggleHealthyTraffic: vi.fn(), reset: resetMock },
        simulateDemoDecision: new SimulateDemoDecision(localRepo, toolsPort, broadcaster),
        liveDemoKey: 'secret-retry-key'
      })
    });

    // Authorized first reset fails transiently during demoControlPort.reset()
    const failedFirst = await request(retryApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-retry-key');
    expect(failedFirst.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);

    // Retry WITHOUT X-Live-Demo-Key MUST STILL be forbidden even though incident is now FAILED
    const unauthorizedRetry = await request(retryApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(unauthorizedRetry.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resetMock).toHaveBeenCalledTimes(1);

    // Authorized retry completes reset and clears pending live reset marker
    const authorizedRetry = await request(retryApp)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'secret-retry-key');
    expect(authorizedRetry.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(resetMock).toHaveBeenCalledTimes(2);
  });

  it('should_reject_live_demo_when_auth_middleware_calls_next_with_error_and_forward_async_rejections', async () => {
    const triggerChaos = vi.fn(async () => {});
    const errorAuthApp = createApp({
      repository: repo,
      targetStatusPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: repo,
        targetStatusPort,
        demoControlPort: { triggerChaos, toggleHealthyTraffic: vi.fn(), reset: vi.fn() },
        simulateDemoDecision,
        liveDemoMiddleware: (_req, _res, next) => {
          next(new Error('auth middleware failure'));
        }
      })
    });

    const authErrorRes = await request(errorAuthApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(authErrorRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(triggerChaos).not.toHaveBeenCalled();

    const rejectingTargetPort: TargetStatusPort = {
      getStatus: vi.fn(async () => {
        throw new Error('target status probe failed');
      })
    };
    const asyncRejectApp = createApp({
      repository: repo,
      targetStatusPort: rejectingTargetPort,
      handleAlert: createStubHandleAlert(repo),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision,
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository: repo,
        targetStatusPort: rejectingTargetPort,
        demoControlPort: { triggerChaos, toggleHealthyTraffic: vi.fn(), reset: vi.fn() },
        simulateDemoDecision,
        publicLiveDemo: true
      })
    });

    const asyncRejectRes = await request(asyncRejectApp)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(asyncRejectRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(triggerChaos).not.toHaveBeenCalled();
  });

  it('should_discard_stale_approval_reset_when_newer_live_chaos_session_started', async () => {
    let resolveStatusProbe!: (value: Awaited<ReturnType<TargetStatusPort['getStatus']>>) => void;
    const deferredStatusPort: TargetStatusPort = {
      getStatus: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<TargetStatusPort['getStatus']>>>((resolve) => {
            resolveStatusProbe = resolve;
          })
      )
    };
    const resetMock = vi.fn(async () => {});
    const lifecycle = createDemoSessionLifecycle(
      { triggerChaos: vi.fn(), toggleHealthyTraffic: vi.fn(), reset: resetMock },
      undefined,
      deferredStatusPort
    );

    const olderTimestamp = Date.now() - 10_000;
    lifecycle.setLastChaos(olderTimestamp, IncidentExecutionMode.LIVE);

    const olderIncident = new Incident({
      id: 'inc-live-older-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:older',
      state: IncidentState.RESOLVED,
      mode: IncidentExecutionMode.LIVE,
      startedAt: new Date(olderTimestamp + 500).toISOString()
    });

    const approvalPromise = lifecycle.handleLiveIncidentApproved(olderIncident);

    // While olderIncident's getStatus() is still in flight, a newer live chaos session starts
    const newerTimestamp = Date.now();
    lifecycle.setLastChaos(newerTimestamp, IncidentExecutionMode.LIVE);

    resolveStatusProbe({
      status: TargetHealthStatus.DEGRADED,
      service: 'api-pagamentos-core',
      version: 'v2.14.8',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: '',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      },
      rawEdgeLogPreCollector: ''
    });

    await approvalPromise;

    expect(resetMock).not.toHaveBeenCalled();
    expect(lifecycle.getLastChaosTimestamp()).toBe(newerTimestamp);
  });
});
