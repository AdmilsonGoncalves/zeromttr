import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  DecisionAction,
  DecisionSource,
  IncidentExecutionMode,
  IncidentState,
  ReasoningProvider,
  TargetHealthStatus
} from '@zeromttr/contracts';
import { IncidentService } from '../src/app/core/incident.service.js';
import { createMockServer, type MockServer } from '../mock-server/server.js';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';

describe('IncidentService', () => {
  let server: MockServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createMockServer();
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should initialize with expected defaults', () => {
    const service = new IncidentService();
    expect(service.currentIncident()).toBeNull();
    expect(service.targetStatus()).toBeNull();
    expect(service.sseConnected()).toBe(false);
    expect(service.activeMode()).toBe(IncidentExecutionMode.REPLAY);
    expect(service.finopsReduction()).toBe(0);
    expect(service.estimatedTokensSaved()).toBe(0);
    expect(service.evidenceCoveragePercent()).toBe(0);
    expect(service.signalsRatio()).toBe('0/4');
    expect(service.timelineSteps()).toHaveLength(8);
  });

  it('should calculate computed signals when incident detail is loaded', () => {
    const service = new IncidentService();
    service.currentIncident.set(JSON.parse(JSON.stringify(MOCK_INCIDENT)));

    expect(service.finopsReduction()).toBe(84);
    expect(service.estimatedTokensSaved()).toBe(10122);
    expect(service.evidenceCoveragePercent()).toBe(100);
    expect(service.signalsRatio()).toBe('4/4');
    expect(service.reasoningSource()).toBe(ReasoningProvider.LLM);
    expect(service.isPiiPassed()).toBe(true);
    expect(service.leakedPatternsCount()).toBe(0);

    const steps = service.timelineSteps();
    expect(steps).toHaveLength(8);
    // Since mock incident is in NOTIFIED state, all 8 steps are completed
    for (const step of steps) {
      expect(step.status).toBe('completed');
    }
  });

  it('should toggle active mode and demo key and persist key in localStorage when available', () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      }
    } as unknown as Storage;
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true
    });

    try {
      const service = new IncidentService();
      service.setActiveMode(IncidentExecutionMode.LIVE);
      expect(service.activeMode()).toBe(IncidentExecutionMode.LIVE);

      service.setLiveDemoKey('secret-demo-token');
      expect(service.liveDemoKey()).toBe('secret-demo-token');
      expect(store.get('zeromttr_live_demo_key')).toBe('secret-demo-token');

      const hydratedService = new IncidentService();
      expect(hydratedService.liveDemoKey()).toBe('secret-demo-token');

      service.setLiveDemoKey('');
      expect(store.has('zeromttr_live_demo_key')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalStorage,
        configurable: true
      });
    }
  });

  it('should fetch target status and incidents from server', async () => {
    const service = new IncidentService();
    await service.fetchTargetStatus(baseUrl);
    expect(service.targetStatus()).not.toBeNull();
    expect(service.targetStatus()?.service).toBe('api-pagamentos-core');

    await service.fetchIncidents(baseUrl);
    expect(service.currentIncident()).not.toBeNull();
    expect(service.currentIncident()?.id).toBe('inc-20261110-001');
  });

  it('should trigger chaos, resetChaos, and simulateDecision while forwarding X-Live-Demo-Key when configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = new IncidentService();
    service.setActiveMode(IncidentExecutionMode.LIVE);
    service.setLiveDemoKey('test-key');

    await service.triggerChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe(TargetHealthStatus.DEGRADED);

    await service.resetChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe(TargetHealthStatus.HEALTHY);

    await service.fetchIncidents(baseUrl);
    await service.simulateDecision(DecisionAction.APPROVE, baseUrl);

    const resetCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/api/demo/reset'));
    const simCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/api/demo/simulate-decision')
    );

    expect(resetCall?.[1]?.headers).toMatchObject({ 'X-Live-Demo-Key': 'test-key' });
    expect(simCall?.[1]?.headers).toMatchObject({ 'X-Live-Demo-Key': 'test-key' });
    fetchSpy.mockRestore();
  });

  it('should execute simulateDecision on current incident', async () => {
    const service = new IncidentService();
    await service.fetchIncidents(baseUrl);

    await service.simulateDecision(DecisionAction.APPROVE, baseUrl);
    expect(service.currentIncident()?.decision).toBe(DecisionAction.APPROVE);
    expect(service.currentIncident()?.decisionSource).toBe(DecisionSource.DEMO_SIMULATION);
    expect(service.currentIncident()?.state).toBe(IncidentState.RESOLVED);
  });

  it('should submit HMAC decision and update decisionStatus', async () => {
    const service = new IncidentService();
    const validExp = Math.floor(Date.now() / 1000) + 3600;

    const ok = await service.submitDecision(
      'inc-20261110-001',
      {
        action: DecisionAction.APPROVE,
        sig: 'valid-hmac-signature',
        exp: validExp
      },
      baseUrl
    );

    expect(ok).toBe(true);
    expect(service.decisionStatus()).toBe('success');
  });

  it('should return structured error details when triggerChaos receives 403 Forbidden', async () => {
    const service = new IncidentService();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'Forbidden: Valid X-Live-Demo-Key required for live execution on public host'
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            service: 'api-pagamentos-core',
            status: TargetHealthStatus.HEALTHY,
            version: 'v2.14.7'
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

    const result = await service.triggerChaos(baseUrl);
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: Valid X-Live-Demo-Key required for live execution on public host'
    });

    fetchSpy.mockRestore();
  });

  it('should compute FSM flow stages and contextual hint across lifecycle states', () => {
    const service = new IncidentService();
    expect(service.fsmHintKey()).toBe('fsmHintIdle');
    expect(service.fsmStages()).toHaveLength(8);
    expect(service.fsmStages().every((stage) => stage.status === 'pending')).toBe(true);
    expect(service.isWorkflowRunning()).toBe(false);

    service.awaitingIncidentStart.set(true);
    expect(service.fsmHintKey()).toBe('fsmHintAwaitingAlert');
    expect(service.fsmStages()[0]?.status).toBe('active');
    expect(service.isWorkflowRunning()).toBe(true);

    service.awaitingIncidentStart.set(false);
    const incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    incident.state = IncidentState.ENRICHING;
    service.currentIncident.set(incident);
    expect(service.fsmHintKey()).toBe('fsmHintActive');
    expect(service.isWorkflowRunning()).toBe(true);
    expect(service.fsmStages().map((stage) => stage.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'active',
      'pending',
      'pending',
      'pending',
      'pending'
    ]);

    incident.state = IncidentState.NOTIFIED;
    service.currentIncident.set({ ...incident });
    expect(service.fsmHintKey()).toBe('fsmHintNotified');
    expect(service.isWorkflowRunning()).toBe(false);
    expect(service.fsmStages()[6]?.status).toBe('active');

    incident.state = IncidentState.RESOLVED;
    service.currentIncident.set({ ...incident });
    expect(service.fsmHintKey()).toBe('fsmHintResolved');
    expect(service.isWorkflowRunning()).toBe(false);
    expect(service.fsmStages().every((stage) => stage.status === 'completed')).toBe(true);
  });

  it('should mark the transition source stage as failed when incident transitions RECEIVED -> INVESTIGATING -> FAILED', () => {
    const service = new IncidentService();
    const incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    incident.state = IncidentState.FAILED;
    incident.transitions = [
      { from: null, to: IncidentState.RECEIVED, at: '2026-11-23T00:00:00Z' },
      { from: IncidentState.RECEIVED, to: IncidentState.INVESTIGATING, at: '2026-11-23T00:00:01Z' },
      {
        from: IncidentState.INVESTIGATING,
        to: IncidentState.FAILED,
        at: '2026-11-23T00:00:02Z',
        reason: 'Reset'
      }
    ];
    service.currentIncident.set(incident);

    expect(service.fsmStages().map((stage) => stage.status)).toEqual([
      'completed',
      'completed',
      'failed',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending'
    ]);
  });

  it('should ignore stale fetchIncident responses after resetChaos clears the incident', async () => {
    const service = new IncidentService();
    const incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    service.currentIncident.set(incident);

    let resolveFetch!: (res: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(`/api/incidents/${incident.id}`)) {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      return new Response(JSON.stringify({ ok: true, status: TargetHealthStatus.HEALTHY }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const pendingFetch = service.fetchIncident(incident.id, baseUrl);
    await service.resetChaos(baseUrl, true);
    expect(service.currentIncident()).toBeNull();

    resolveFetch(
      new Response(JSON.stringify(incident), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    await pendingFetch;

    expect(service.currentIncident()).toBeNull();
    fetchSpy.mockRestore();
  });

  it('should_toggle_healthy_traffic_and_expose_target_metrics', async () => {
    const service = new IncidentService();
    service.setLiveDemoKey('secret-key');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, healthyTrafficActive: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'healthy',
            service: 'api-pagamentos-core',
            version: 'v2.14.7',
            previousHealthyVersion: 'v2.14.7',
            metrics: {
              requestsPerSecond: 2.4,
              errorRate5xxPercent: 0,
              p95LatencyMs: 18,
              poolActive: 1,
              poolWaiting: 0,
              poolMax: 10,
              healthyTrafficActive: true
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

    const result = await service.toggleHealthyTraffic(true, 'http://localhost:8080');
    expect(result).toEqual({ ok: true, status: 200 });
    expect(service.targetMetrics()?.healthyTrafficActive).toBe(true);
    expect(service.targetMetrics()?.requestsPerSecond).toBe(2.4);
    expect(service.targetMetrics()?.poolMax).toBe(10);

    fetchSpy.mockRestore();
  });

  it('should_fetch_demo_config_attach_turnstile_header_and_consume_token_after_action', async () => {
    const service = new IncidentService();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            publicLiveDemo: true,
            turnstileSiteKey: '0x4AAAAAAATestKey',
            turnstileRequired: true
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'accepted', mode: 'live' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'healthy',
            service: 'api-pagamentos-core',
            version: 'v2.14.8',
            previousHealthyVersion: 'v2.14.7'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    await service.fetchDemoConfig('http://localhost:8080');
    expect(service.publicLiveDemo()).toBe(true);
    expect(service.turnstileSiteKey()).toBe('0x4AAAAAAATestKey');
    expect(service.turnstileRequired()).toBe(true);
    expect(service.isSimulationLockedByTurnstile()).toBe(true);

    service.setTurnstileToken('cf-token-abc');
    expect(service.isSimulationLockedByTurnstile()).toBe(false);

    service.setActiveMode('live');
    const chaosResult = await service.triggerChaos('http://localhost:8080');
    expect(chaosResult).toEqual({ ok: true, status: 202 });

    const chaosCallInit = fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined;
    const chaosHeaders = chaosCallInit?.headers as Record<string, string> | undefined;
    expect(chaosHeaders?.['CF-Turnstile-Response']).toBe('cf-token-abc');

    // Token is single-use and must be cleared + reset counter incremented
    expect(service.turnstileToken()).toBeNull();
    expect(service.turnstileResetCounter()).toBe(1);
    expect(service.isSimulationLockedByTurnstile()).toBe(true);

    fetchSpy.mockRestore();
  });
});
