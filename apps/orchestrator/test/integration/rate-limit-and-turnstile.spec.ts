import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nock from 'nock';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { FileIncidentRepository } from '../../src/adapters/repo.file.js';
import { createDemoRouterFactory } from '../../src/demo/demo.controller.js';
import { SimulateDemoDecision } from '../../src/demo/simulate-demo-decision.js';
import {
  AlertSeverity,
  DecisionAction,
  IncidentExecutionMode
} from '../../src/domain/incident-enums.js';
import { Incident } from '../../src/domain/incident.js';
import { IncidentState } from '../../src/domain/incident-state.js';
import { createApp } from '../../src/http/app.js';
import { SseEventBroadcaster } from '../../src/http/events.sse.js';
import { extractClientIp } from '../../src/http/rate-limit.js';
import {
  createMockDemoControlPort,
  createMockTargetStatusPort,
  createMockToolsPort,
  createStubHandleAlert,
  createStubRecordDecision,
  createStubWorkflow
} from '../helpers/test-doubles.helper.js';

describe('Public Live Demo, IP Rate Limiting & Cloudflare Turnstile Gate', () => {
  const DASHBOARD_TOKEN = 'test-dashboard-token';
  let tempDir: string;
  let repository: FileIncidentRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-turnstile-test-'));
    repository = new FileIncidentRepository(path.join(tempDir, 'incidents.json'));
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function buildTestApp(options: {
    publicLiveDemo?: boolean;
    liveDemoKey?: string;
    turnstileSiteKey?: string;
    turnstileSecretKey?: string;
    enableRateLimiting?: boolean;
  }) {
    const toolsPort = createMockToolsPort();
    const broadcaster = new SseEventBroadcaster();
    const demoControlPort = createMockDemoControlPort();
    const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster);

    const demoRouter = createDemoRouterFactory({
      repository,
      demoControlPort,
      simulateDemoDecision,
      liveDemoKey: options.liveDemoKey,
      publicLiveDemo: options.publicLiveDemo,
      turnstileSiteKey: options.turnstileSiteKey,
      turnstileSecretKey: options.turnstileSecretKey,
      cooldownMs: 0
    });

    return createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      grafanaWebhookToken: 'test-grafana-token',
      demoRouter,
      enableRateLimiting: options.enableRateLimiting ?? false
    });
  }

  it('should expose publicLiveDemo and turnstileSiteKey via GET /api/demo/config', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      liveDemoKey: 'secret-key-ignored-when-public',
      turnstileSiteKey: '0x4AAAAAAATestSiteKey',
      turnstileSecretKey: '0x4AAAAAAATestSecretKey'
    });

    const res = await request(app)
      .get('/api/demo/config')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);

    expect(res.status).toBe(HTTP_STATUS.OK);
    expect(res.body).toEqual({
      publicLiveDemo: true,
      turnstileSiteKey: '0x4AAAAAAATestSiteKey',
      turnstileRequired: true
    });
  });

  it('should allow live chaos without X-Live-Demo-Key when PUBLIC_LIVE_DEMO=true and Turnstile passes', async () => {
    nock('https://challenges.cloudflare.com')
      .post('/turnstile/v0/siteverify')
      .reply(200, { success: true });

    const app = buildTestApp({
      publicLiveDemo: true,
      liveDemoKey: 'configured-secret-key',
      turnstileSiteKey: '0x4AAAAAAATestSiteKey',
      turnstileSecretKey: '0x4AAAAAAATestSecretKey'
    });

    const res = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Turnstile-Response', 'valid-turnstile-token')
      .set('CF-Connecting-IP', '203.0.113.42')
      .send({ mode: IncidentExecutionMode.LIVE });

    expect(res.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(res.body.mode).toBe(IncidentExecutionMode.LIVE);
  });

  it('should reject both live and replay chaos with 403 when Turnstile is configured and token is missing or invalid', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      turnstileSiteKey: '0x4AAAAAAATestSiteKey',
      turnstileSecretKey: '0x4AAAAAAATestSecretKey'
    });

    const missingRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(missingRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(missingRes.body.code).toBe('TURNSTILE_REQUIRED');
    expect(missingRes.body.error).toContain('Turnstile verification required');

    nock('https://challenges.cloudflare.com')
      .post('/turnstile/v0/siteverify')
      .reply(200, { success: false, 'error-codes': ['invalid-input-response'] });

    const invalidRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Turnstile-Response', 'expired-or-fake-token');

    expect(invalidRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(invalidRes.body.code).toBe('TURNSTILE_REJECTED');
    expect(invalidRes.body.error).toContain('Turnstile verification rejected');
  });

  it('should reject partial Turnstile configuration (siteKey without secretKey or vice versa)', () => {
    expect(() =>
      buildTestApp({
        publicLiveDemo: true,
        turnstileSiteKey: '0x4AAAAAAATestSiteKey'
      })
    ).toThrow(/TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY/);

    expect(() =>
      buildTestApp({
        publicLiveDemo: true,
        turnstileSecretKey: '0x4AAAAAAATestSecretKey'
      })
    ).toThrow(/TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY/);
  });

  it('should enforce per-IP rate limiting on simulation endpoints using CF-Connecting-IP (IPv4 and IPv6)', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      enableRateLimiting: true
    });

    for (let i = 0; i < 30; i++) {
      const ipHeader = i % 2 === 0 ? '198.51.100.10' : '::ffff:198.51.100.10';
      const okRes = await request(app)
        .post('/api/demo/reset')
        .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
        .set('CF-Connecting-IP', ipHeader);
      expect(okRes.status).toBe(HTTP_STATUS.ACCEPTED);
    }

    const throttledRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Connecting-IP', '198.51.100.10');

    expect(throttledRes.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(throttledRes.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(throttledRes.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    // Different IPv6 client should still be allowed
    const otherIpRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Connecting-IP', '2001:db8::1');
    expect(otherIpRes.status).toBe(HTTP_STATUS.ACCEPTED);
  });

  it('should protect healthy-traffic and simulate-decision with Turnstile and fail closed on siteverify errors', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      turnstileSiteKey: '0x4AAAAAAATestSiteKey',
      turnstileSecretKey: '0x4AAAAAAATestSecretKey'
    });

    const trafficMissingRes = await request(app)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ enable: true });
    expect(trafficMissingRes.status).toBe(HTTP_STATUS.FORBIDDEN);

    const decisionMissingRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: 'inc-unknown', action: 'approve' });
    expect(decisionMissingRes.status).toBe(HTTP_STATUS.FORBIDDEN);

    // Siteverify HTTP 500 must fail closed with 403
    nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').reply(500);
    const serverErrRes = await request(app)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Turnstile-Response', 'valid-token')
      .send({ enable: true });
    expect(serverErrRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(serverErrRes.body.error).toContain('Turnstile verification failed');

    // Siteverify network error must fail closed with 403
    nock('https://challenges.cloudflare.com')
      .post('/turnstile/v0/siteverify')
      .replyWithError('ECONNRESET');
    const netErrRes = await request(app)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Turnstile-Response', 'valid-token')
      .send({ enable: true });
    expect(netErrRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(netErrRes.body.error).toContain('Turnstile verification unavailable');

    // Valid siteverify allows healthy-traffic
    nock('https://challenges.cloudflare.com')
      .post('/turnstile/v0/siteverify')
      .reply(200, { success: true });
    const okRes = await request(app)
      .post('/api/demo/healthy-traffic')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('CF-Turnstile-Response', 'valid-token')
      .send({ enable: true });
    expect(okRes.status).toBe(HTTP_STATUS.OK);
    expect(okRes.body.healthyTrafficActive).toBe(true);
  });

  it('should extract first client IP from X-Forwarded-For when CF-Connecting-IP is absent', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      enableRateLimiting: true
    });

    for (let i = 0; i < 30; i++) {
      const okRes = await request(app)
        .post('/api/demo/reset')
        .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
        .set('X-Forwarded-For', '203.0.113.77, 10.0.0.1');
      expect(okRes.status).toBe(HTTP_STATUS.ACCEPTED);
    }

    const throttledRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Forwarded-For', '203.0.113.77, 10.0.0.2');
    expect(throttledRes.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('should ignore spoofed forwarding headers from untrusted public peer IPs and honor X-Real-IP from trusted proxies', () => {
    const untrustedReq = {
      headers: {
        'cf-connecting-ip': '203.0.113.99',
        'x-forwarded-for': '203.0.113.100',
        'x-real-ip': '203.0.113.101'
      },
      socket: { remoteAddress: '198.51.100.55' }
    } as unknown as Request;
    expect(extractClientIp(untrustedReq)).toBe('198.51.100.55');

    const trustedNginxReq = {
      headers: {
        'x-real-ip': '203.0.113.88'
      },
      socket: { remoteAddress: '172.18.0.5' }
    } as unknown as Request;
    expect(extractClientIp(trustedNginxReq)).toBe('203.0.113.88');

    const cloudflareDisabledReq = {
      headers: {
        'cf-connecting-ip': '203.0.113.99',
        'x-real-ip': '203.0.113.88'
      },
      socket: { remoteAddress: '172.18.0.5' }
    } as unknown as Request;
    expect(extractClientIp(cloudflareDisabledReq, { trustCloudflareHeaders: false })).toBe(
      '203.0.113.88'
    );
  });

  it('should keep strict 30 req/min RateLimit-Limit header on POST /api/incidents/:id/decision', async () => {
    const app = buildTestApp({
      publicLiveDemo: true,
      enableRateLimiting: true
    });

    const res = await request(app)
      .post('/api/incidents/inc-missing/decision')
      .send({ action: 'invalid-action', sig: '' });

    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.headers['ratelimit-limit']).toBe('30');
  });

  it('should restore target chaos automatically on approved simulate-decision and fail closed on reset when repo lookup fails', async () => {
    const incident = new Incident({
      id: 'inc-sim-reset-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:sim-reset',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.REPLAY
    });
    await repository.save(incident);

    const demoControlPort = createMockDemoControlPort();
    const toolsPort = createMockToolsPort();
    const broadcaster = new SseEventBroadcaster();
    const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster);

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      grafanaWebhookToken: 'test-grafana-token',
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort,
        simulateDemoDecision,
        liveDemoKey: 'strict-live-key',
        cooldownMs: 0
      }),
      enableRateLimiting: false
    });

    const simRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: incident.id, action: DecisionAction.APPROVE });

    expect(simRes.status).toBe(HTTP_STATUS.OK);
    expect(demoControlPort.reset).toHaveBeenCalledTimes(1);

    vi.spyOn(repository, 'findAll').mockRejectedValueOnce(new Error('DB connection lost'));
    const resetRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(resetRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(demoControlPort.reset).toHaveBeenCalledTimes(1);
  });

  it('should require X-Live-Demo-Key when approving a replay incident during an active live session and allow retry if reset fails', async () => {
    const replayIncident = new Incident({
      id: 'inc-replay-active-live',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:replay-active-live',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.REPLAY
    });
    await repository.save(replayIncident);

    const demoControlPort = createMockDemoControlPort();
    const toolsPort = createMockToolsPort();
    const broadcaster = new SseEventBroadcaster();
    const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster);

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      grafanaWebhookToken: 'test-grafana-token',
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort,
        simulateDemoDecision,
        liveDemoKey: 'strict-live-key',
        cooldownMs: 0
      }),
      enableRateLimiting: false
    });

    // Start an authorized live session
    const liveChaosRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'strict-live-key')
      .send({ mode: IncidentExecutionMode.LIVE });
    expect(liveChaosRes.status).toBe(HTTP_STATUS.ACCEPTED);

    // Approving a replay incident without X-Live-Demo-Key while live session is active must fail with 403
    const deniedReplayRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(deniedReplayRes.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(demoControlPort.reset).not.toHaveBeenCalled();

    // With X-Live-Demo-Key, if target reset fails once, retry succeeds idempotently
    vi.mocked(demoControlPort.reset).mockRejectedValueOnce(new Error('Target unreachable'));
    const failedResetRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'strict-live-key')
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(failedResetRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);

    // Live-session state must remain intact after reset failure so unauthenticated /demo/reset is still rejected
    const unauthResetAfterFailure = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(unauthResetAfterFailure.status).toBe(HTTP_STATUS.FORBIDDEN);

    const retryRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'strict-live-key')
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(retryRes.status).toBe(HTTP_STATUS.OK);
    expect(demoControlPort.reset).toHaveBeenCalledTimes(2);
  });

  it('should clear pending target restorations when an explicit /demo/reset succeeds', async () => {
    const replayIncident = new Incident({
      id: 'inc-replay-explicit-reset',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:replay-explicit-reset',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.REPLAY
    });
    await repository.save(replayIncident);

    const demoControlPort = createMockDemoControlPort();
    const toolsPort = createMockToolsPort();
    const broadcaster = new SseEventBroadcaster();
    const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster);

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      grafanaWebhookToken: 'test-grafana-token',
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort,
        simulateDemoDecision,
        liveDemoKey: 'strict-live-key',
        cooldownMs: 0
      }),
      enableRateLimiting: false
    });

    vi.mocked(demoControlPort.reset).mockRejectedValueOnce(new Error('Target unreachable'));
    const failedApproveRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(failedApproveRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);

    const explicitResetRes = await request(app)
      .post('/api/demo/reset')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);
    expect(explicitResetRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(demoControlPort.reset).toHaveBeenCalledTimes(2);

    const staleRetryRes = await request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE });
    expect(staleRetryRes.status).toBe(HTTP_STATUS.CONFLICT);
    expect(demoControlPort.reset).toHaveBeenCalledTimes(2);
  });

  it('should serialize simulate-decision with live chaos using explicit lookup and trigger barriers', async () => {
    const replayIncident = new Incident({
      id: 'inc-replay-race',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'alert:replay-race',
      state: IncidentState.NOTIFIED,
      mode: IncidentExecutionMode.REPLAY
    });
    await repository.save(replayIncident);

    let signalFindByIdEntered!: () => void;
    const findByIdEntered = new Promise<void>((resolve) => {
      signalFindByIdEntered = resolve;
    });
    let releaseFindById!: () => void;
    const findByIdGate = new Promise<void>((resolve) => {
      releaseFindById = resolve;
    });

    const originalFindById = repository.findById.bind(repository);
    let findByIdCalls = 0;
    vi.spyOn(repository, 'findById').mockImplementation(async (id: string) => {
      findByIdCalls += 1;
      if (findByIdCalls === 1) {
        signalFindByIdEntered();
        await findByIdGate;
      }
      return originalFindById(id);
    });

    const callOrder: string[] = [];
    let triggerChaosEntered = false;
    const demoControlPort = createMockDemoControlPort();
    vi.mocked(demoControlPort.reset).mockImplementation(async () => {
      callOrder.push('reset');
    });
    vi.mocked(demoControlPort.triggerChaos).mockImplementation(async () => {
      triggerChaosEntered = true;
      callOrder.push('triggerChaos');
    });
    const toolsPort = createMockToolsPort();
    const broadcaster = new SseEventBroadcaster();
    const simulateDemoDecision = new SimulateDemoDecision(repository, toolsPort, broadcaster);

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      grafanaWebhookToken: 'test-grafana-token',
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort,
        simulateDemoDecision,
        liveDemoKey: 'strict-live-key',
        cooldownMs: 0
      }),
      enableRateLimiting: false
    });

    // Subscribe immediately so Supertest dispatches the unkeyed replay approval now
    const approvalPromise = request(app)
      .post('/api/demo/simulate-decision')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ incidentId: replayIncident.id, action: DecisionAction.APPROVE })
      .then((res) => res);

    await findByIdEntered;

    // Dispatch keyed live chaos while replay approval is paused inside runSerialized
    const liveChaosPromise = request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .set('X-Live-Demo-Key', 'strict-live-key')
      .send({ mode: IncidentExecutionMode.LIVE })
      .then((res) => res);

    // Yield across network/event-loop turns so liveChaos reaches runSerialized queue
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(triggerChaosEntered).toBe(false);

    releaseFindById();

    const [approvalRes, liveChaosRes] = await Promise.all([approvalPromise, liveChaosPromise]);
    expect(approvalRes.status).toBe(HTTP_STATUS.OK);
    expect(liveChaosRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(callOrder).toEqual(['reset', 'triggerChaos']);
  });
});
