import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { FileIncidentRepository } from '../../src/adapters/index.js';
import {
  createDemoRouterFactory,
  ReplayRunner,
  SimulateDemoDecision
} from '../../src/demo/index.js';
import { IncidentEventType, IncidentExecutionMode, IncidentState } from '../../src/domain/index.js';
import { createApp, SseEventBroadcaster } from '../../src/http/index.js';
import { collectSseEventsUntil } from '../helpers/http.js';
import {
  createMockDemoControlPort,
  createMockTargetStatusPort,
  createMockToolsPort,
  createStubHandleAlert,
  createStubRecordDecision,
  createStubWorkflow
} from '../helpers/test-doubles.helper.js';

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

    await new Promise((resolve) => setTimeout(resolve, 40));

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
});
