import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { FileIncidentRepository } from '../../src/adapters/repo.file.js';
import { createDemoRouterFactory } from '../../src/demo/demo.controller.js';
import { ReplayRunner } from '../../src/demo/replay-runner.js';
import { SimulateDemoDecision } from '../../src/demo/simulate-demo-decision.js';
import { IncidentEventType, IncidentExecutionMode } from '../../src/domain/incident-enums.js';
import { IncidentState } from '../../src/domain/incident-state.js';
import { createApp } from '../../src/http/app.js';
import { SseEventBroadcaster } from '../../src/http/events.sse.js';
import { collectSseEventsUntil } from '../helpers/http.js';
import {
  createMockDemoControlPort,
  createMockTargetStatusPort,
  createMockToolsPort,
  createStubHandleAlert,
  createStubRecordDecision,
  createStubWorkflow
} from '../helpers/test-doubles.helper.js';

async function waitForActiveSseClients(
  broadcaster: SseEventBroadcaster,
  expectedCount: number,
  timeoutMs = 1500
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (broadcaster.getActiveClientsCount() >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for active SSE clients >= ${expectedCount} (current: ${broadcaster.getActiveClientsCount()})`
  );
}

describe('Demo Replay Mode Integration (TECH 09 §6)', () => {
  const DASHBOARD_TOKEN = 'replay-dashboard-token';
  let tempDir: string;
  let broadcaster: SseEventBroadcaster;
  let server: http.Server | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-replay-'));
    broadcaster = new SseEventBroadcaster(60_000);
  });

  afterEach(async () => {
    broadcaster.close();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should stream recorded replay snapshot via SSE, advance skipped states cleanly, and assign unique incident IDs', async () => {
    const snapshotPath = path.join(tempDir, 'last-recorded-incident.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        recordedAt: '2026-11-07T18:00:00.000Z',
        incidentId: 'inc-live-demo-golden',
        service: 'api-pagamentos-core',
        severity: 'critical',
        evidenceCoverage: {
          score: 100,
          signalsCollected: 4,
          signalsTotal: 4,
          signals: ['promql_anomaly', 'metric_exemplar', 'tempo_error_span', 'loki_log_diff']
        },
        blastRadius: {
          servicesInvolved: ['api-pagamentos-core', 'postgres']
        },
        finops: {
          rawBytesFetched: 48200,
          compactedBytesSentToLlm: 2890,
          payloadReductionPercent: 94,
          estimatedTokensSaved: 11328
        },
        piiGuardAudit: {
          leakedPatternsDetected: 0,
          detectedTypes: [],
          edgeRedactedTokensVerified: 4,
          passed: true
        },
        rca: {
          summary: 'Degradação crítica com p95 > 4.5s causada por saturação do pool.',
          rootCause: 'Commit 8f14e45 removeu client.release() e reduziu pool max para 2.',
          reasoningSource: 'llm',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          diagnosisSeconds: 6,
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          criticalSpan: 'pg.pool.acquire',
          logSample: 'ERROR [api-pagamentos-core] Pool exhausted [REDACTED_CPF]',
          mitigations: ['Restore finally { client.release(); }']
        },
        remediation: {
          branchName: 'hotfix/zeromttr-inc-live-demo-golden',
          branchUrl:
            'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-demo-golden',
          pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
          commitSha: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4'
        },
        eventsTimeline: [
          { event: 'incident.created', delayMs: 5 },
          // Deliberately skip INVESTIGATING to assert safe intermediate progression
          { event: 'incident.transition', state: 'ENRICHING', delayMs: 5 },
          { event: 'incident.rca', delayMs: 5 },
          { event: 'incident.remediation', delayMs: 5 }
          // Deliberately omit trailing NOTIFIED transition to assert completion guarantee
        ]
      }),
      'utf-8'
    );

    const storePath = path.join(tempDir, 'incidents.json');
    const repository = new FileIncidentRepository(storePath);
    const toolsPort = createMockToolsPort();
    const replayRunner = new ReplayRunner(repository, broadcaster, {
      snapshotPath,
      speedFactor: 1
    });

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(repository),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(repository),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort: createMockDemoControlPort(),
        simulateDemoDecision: new SimulateDemoDecision(repository, toolsPort, broadcaster),
        replayRunner,
        cooldownMs: 0
      })
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server?.listen(0, () => resolve()));

    const ssePromise = collectSseEventsUntil(
      server,
      '/api/events',
      { Authorization: `Bearer ${DASHBOARD_TOKEN}` },
      (events) =>
        events.some(
          (evt) =>
            evt.event === IncidentEventType.TRANSITION &&
            typeof evt.data === 'object' &&
            evt.data !== null &&
            (evt.data as { to?: string }).to === IncidentState.NOTIFIED
        ),
      1500
    );

    await waitForActiveSseClients(broadcaster, 1, 1500);

    const triggerRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(triggerRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(triggerRes.body.mode).toBe(IncidentExecutionMode.REPLAY);
    const firstIncidentId = String(triggerRes.body.incidentId);
    expect(firstIncidentId).toContain('inc-live-demo-golden-');

    const capturedEvents = await ssePromise;
    const receivedEventNames = capturedEvents.map((e) => e.event);

    expect(receivedEventNames).toContain(IncidentEventType.CREATED);
    expect(receivedEventNames).toContain(IncidentEventType.TRANSITION);
    expect(receivedEventNames).toContain(IncidentEventType.RCA);
    expect(receivedEventNames).toContain(IncidentEventType.REMEDIATION);
    expect(receivedEventNames).toContain(IncidentEventType.FINOPS);
    expect(receivedEventNames).toContain(IncidentEventType.NOTIFIED);

    const incRes = await request(app)
      .get(`/api/incidents/${firstIncidentId}`)
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`);

    expect(incRes.status).toBe(HTTP_STATUS.OK);
    expect(incRes.body.state).toBe(IncidentState.NOTIFIED);
    expect(incRes.body.mode).toBe(IncidentExecutionMode.REPLAY);
    expect(incRes.body.finops.compactedBytesSent).toBe(2890);
    expect(incRes.body.rca.rootCause).toContain('client.release()');

    // Second replay creates a distinct incident ID so Dashboard resets cleanly
    const secondTriggerRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(secondTriggerRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(secondTriggerRes.body.incidentId).not.toBe(firstIncidentId);
    replayRunner.stop();
  });

  it('should cancel pending replay timers immediately when stop() is called', async () => {
    const snapshotPath = path.join(tempDir, 'slow-replay.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        recordedAt: '2026-11-07T18:00:00.000Z',
        incidentId: 'inc-live-demo-slow',
        service: 'api-pagamentos-core',
        severity: 'critical',
        evidenceCoverage: {
          score: 100,
          signalsCollected: 4,
          signalsTotal: 4,
          signals: ['promql_anomaly', 'metric_exemplar', 'tempo_error_span', 'loki_log_diff']
        },
        blastRadius: {
          servicesInvolved: ['api-pagamentos-core']
        },
        finops: {
          rawBytesFetched: 1000,
          compactedBytesSentToLlm: 100,
          payloadReductionPercent: 90,
          estimatedTokensSaved: 225
        },
        piiGuardAudit: {
          leakedPatternsDetected: 0,
          detectedTypes: [],
          edgeRedactedTokensVerified: 1,
          passed: true
        },
        rca: {
          summary: 'Pool exhausted',
          rootCause: 'Missing client.release()',
          reasoningSource: 'llm',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts'
        },
        remediation: {
          branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-slow',
          pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/2',
          commitSha: '1234567'
        },
        eventsTimeline: [
          { event: 'incident.created', delayMs: 30_000 },
          { event: 'incident.transition', state: 'NOTIFIED', delayMs: 30_000 }
        ]
      }),
      'utf-8'
    );

    const storePath = path.join(tempDir, 'incidents-slow.json');
    const repository = new FileIncidentRepository(storePath);
    const replayRunner = new ReplayRunner(repository, broadcaster, {
      snapshotPath,
      speedFactor: 1
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const incidentId = await replayRunner.trigger();
    await new Promise((resolve) => setTimeout(resolve, 10));

    replayRunner.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    const saved = await repository.findById(incidentId);
    expect(saved?.state).toBe(IncidentState.RECEIVED);
  });

  it('should prevent a stale concurrent trigger from registering replay timers after stop()', async () => {
    const snapshotPath = path.join(tempDir, 'concurrent-replay.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        recordedAt: '2026-11-07T18:00:00.000Z',
        incidentId: 'inc-live-demo-concurrent',
        service: 'api-pagamentos-core',
        severity: 'critical',
        evidenceCoverage: {
          score: 100,
          signalsCollected: 4,
          signalsTotal: 4,
          signals: ['promql_anomaly', 'metric_exemplar', 'tempo_error_span', 'loki_log_diff']
        },
        blastRadius: {
          servicesInvolved: ['api-pagamentos-core']
        },
        finops: {
          rawBytesFetched: 1000,
          compactedBytesSentToLlm: 100,
          payloadReductionPercent: 90,
          estimatedTokensSaved: 225
        },
        piiGuardAudit: {
          leakedPatternsDetected: 0,
          detectedTypes: [],
          edgeRedactedTokensVerified: 1,
          passed: true
        },
        rca: {
          summary: 'Pool exhausted',
          rootCause: 'Missing client.release()',
          reasoningSource: 'llm',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts'
        },
        remediation: {
          branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-conc',
          pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/3',
          commitSha: '1234567'
        },
        eventsTimeline: [
          { event: 'incident.created', delayMs: 30_000 },
          { event: 'incident.transition', state: 'NOTIFIED', delayMs: 30_000 }
        ]
      }),
      'utf-8'
    );

    const storePath = path.join(tempDir, 'incidents-concurrent.json');
    const repository = new FileIncidentRepository(storePath);

    let releaseFirstSave: (() => void) | undefined;
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });

    const originalSave = repository.save.bind(repository);
    let saveCalls = 0;
    vi.spyOn(repository, 'save').mockImplementation(async (incident) => {
      saveCalls++;
      if (saveCalls === 1) {
        await firstSaveBlocked;
      }
      await originalSave(incident);
    });

    const activeReplayTimers = new Set<ReturnType<typeof setTimeout>>();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      const handle = realSetTimeout(
        (...cbArgs: unknown[]) => {
          activeReplayTimers.delete(handle);
          fn(...cbArgs);
        },
        ms,
        ...args
      );
      if (ms === 30_000) {
        activeReplayTimers.add(handle);
      }
      return handle;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
      handle?: ReturnType<typeof setTimeout>
    ) => {
      if (handle) {
        activeReplayTimers.delete(handle);
      }
      return realClearTimeout(handle);
    }) as typeof clearTimeout);

    const replayRunner = new ReplayRunner(repository, broadcaster, {
      snapshotPath,
      speedFactor: 1
    });

    const firstTriggerPromise = replayRunner.trigger();
    const secondTriggerId = await replayRunner.trigger();
    await new Promise((resolve) => realSetTimeout(resolve, 10));

    replayRunner.stop();
    releaseFirstSave?.();
    const firstTriggerId = await firstTriggerPromise;
    await new Promise((resolve) => realSetTimeout(resolve, 10));

    expect(firstTriggerId).not.toBe(secondTriggerId);
    expect(activeReplayTimers.size).toBe(0);
  });

  it('should_reject_replay_requests_without_updating_cooldown_when_replayRunner_is_unconfigured', async () => {
    const storePath = path.join(tempDir, 'incidents-no-replay.json');
    const repository = new FileIncidentRepository(storePath);
    const toolsPort = createMockToolsPort();
    const demoControlPort = createMockDemoControlPort();

    const app = createApp({
      repository,
      targetStatusPort: createMockTargetStatusPort(),
      handleAlert: createStubHandleAlert(repository),
      orchestratorWorkflow: createStubWorkflow(),
      recordDecision: createStubRecordDecision(repository),
      broadcaster,
      dashboardApiToken: DASHBOARD_TOKEN,
      demoRouter: createDemoRouterFactory({
        repository,
        demoControlPort,
        simulateDemoDecision: new SimulateDemoDecision(repository, toolsPort, broadcaster),
        publicLiveDemo: true,
        cooldownMs: 60_000
      })
    });

    const replayRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.REPLAY });

    expect(replayRes.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(replayRes.body.code).toBe('REPLAY_UNAVAILABLE');

    // Cooldown must NOT have been set by the rejected replay request
    const liveRes = await request(app)
      .post('/api/demo/chaos')
      .set('Authorization', `Bearer ${DASHBOARD_TOKEN}`)
      .send({ mode: IncidentExecutionMode.LIVE });

    expect(liveRes.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(demoControlPort.triggerChaos).toHaveBeenCalledTimes(1);
  });
});
