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
    const idleSteps = service.timelineSteps();
    expect(idleSteps).toHaveLength(8);
    expect(idleSteps.every((step) => step.status === 'pending')).toBe(true);
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

  it('should cancel in-flight syncIncidentFallback polling when resetChaos clears awaiting state', async () => {
    const service = new IncidentService();
    service.awaitingIncidentStart.set(true);

    let resolveList!: (res: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/incidents')) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      }
      if (url.endsWith('/api/demo/reset')) {
        return new Response(JSON.stringify({ status: 'reset_completed' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(
        JSON.stringify({
          status: TargetHealthStatus.HEALTHY,
          service: 'api-pagamentos-core',
          version: 'v2.14.7',
          previousHealthyVersion: 'v2.14.7'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    service.startTargetStatusPolling('http://localhost:8080', 10);
    await new Promise((resolve) => setTimeout(resolve, 25));
    service.stopTargetStatusPolling();

    await service.resetChaos('http://localhost:8080', true);
    expect(service.awaitingIncidentStart()).toBe(false);

    resolveList(
      new Response(
        JSON.stringify([{ id: MOCK_INCIDENT.id, startedAt: new Date().toISOString() }]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.currentIncident()).toBeNull();
    expect(service.awaitingIncidentStart()).toBe(false);
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
    expect(service.demoModeEnabled()).toBe(true);
    expect(service.requireDemoKey()).toBe(false);
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

  it('should_retry_fetchDemoConfig_on_failed_or_thrown_requests_and_store_turnstile_config_when_recovered', async () => {
    const service = new IncidentService();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            publicLiveDemo: true,
            turnstileSiteKey: '0x4AAAAAAARetryKey',
            turnstileRequired: true
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    await service.fetchDemoConfig('http://localhost:8080', 3, 1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(service.publicLiveDemo()).toBe(true);
    expect(service.turnstileSiteKey()).toBe('0x4AAAAAAARetryKey');
    expect(service.turnstileRequired()).toBe(true);

    fetchSpy.mockRestore();
  });

  it('should_abort_stalled_fetchDemoConfig_after_deadline_and_recover_on_retry', async () => {
    const service = new IncidentService();
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            publicLiveDemo: true,
            turnstileSiteKey: '0x4AAAAAAADeadlineRecovered',
            turnstileRequired: true
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    await service.fetchDemoConfig('http://localhost:8080', 2, 1, 20);
    expect(callCount).toBe(2);
    expect(service.turnstileSiteKey()).toBe('0x4AAAAAAADeadlineRecovered');
    expect(service.turnstileRequired()).toBe(true);

    fetchSpy.mockRestore();
  });

  it('should_treat_404_from_fetchDemoConfig_as_terminal_without_retrying_or_polling', async () => {
    const service = new IncidentService();
    const configCalls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/demo/config')) {
        configCalls.push(url);
        return new Response('Not Found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          status: TargetHealthStatus.HEALTHY,
          service: 'api-pagamentos-core',
          version: 'v2.14.7',
          previousHealthyVersion: 'v2.14.7'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await service.fetchDemoConfig('http://localhost:8080', 3, 1);
    expect(configCalls).toHaveLength(1);
    expect(service.demoModeEnabled()).toBe(false);
    expect(service.requireDemoKey()).toBe(true);
    expect(service.publicLiveDemo()).toBe(false);
    expect(service.turnstileSiteKey()).toBeNull();

    service.startTargetStatusPolling('http://localhost:8080', 15);
    await new Promise((resolve) => setTimeout(resolve, 45));
    service.stopTargetStatusPolling();

    expect(configCalls).toHaveLength(1);
    fetchSpy.mockRestore();
  });

  it('should_preserve_newer_turnstile_token_and_skip_widget_reset_when_slow_request_finishes', async () => {
    const service = new IncidentService();
    service.turnstileRequired.set(true);
    service.setTurnstileToken('token-1');

    let resolveChaos!: (res: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/demo/chaos')) {
        return new Promise<Response>((resolve) => {
          resolveChaos = resolve;
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: TargetHealthStatus.HEALTHY,
            service: 'api-pagamentos-core',
            version: 'v2.14.7',
            previousHealthyVersion: 'v2.14.7'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    const pendingChaos = service.triggerChaos('http://localhost:8080');
    expect(service.turnstileToken()).toBeNull();

    service.setTurnstileToken('token-2');
    resolveChaos(
      new Response(JSON.stringify({ status: 'accepted', mode: 'replay' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const result = await pendingChaos;
    expect(result).toEqual({ ok: true, status: 202 });
    expect(service.turnstileToken()).toBe('token-2');
    expect(service.turnstileResetCounter()).toBe(0);

    fetchSpy.mockRestore();
  });

  it('should_buffer_bounded_telemetryHistory_across_fetchTargetStatus_polls_and_retain_recovery_curve', async () => {
    const service = new IncidentService();
    let sampleIdx = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      sampleIdx += 1;
      const isDegraded = sampleIdx <= 25;
      return new Response(
        JSON.stringify({
          status: isDegraded ? TargetHealthStatus.DEGRADED : TargetHealthStatus.HEALTHY,
          service: 'api-pagamentos-core',
          version: isDegraded ? 'v2.14.8' : 'v2.14.7',
          previousHealthyVersion: 'v2.14.7',
          metrics: {
            requestsPerSecond: Number((1.2 + sampleIdx * 0.1).toFixed(1)),
            errorRate5xxPercent: isDegraded ? 100 : 0,
            p95LatencyMs: isDegraded ? 1200 : 22,
            poolActive: isDegraded ? 2 : 1,
            poolWaiting: isDegraded ? 3 : 0,
            poolMax: isDegraded ? 2 : 10,
            healthyTrafficActive: true
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    for (let i = 0; i < 50; i++) {
      await service.fetchTargetStatus('http://localhost:8080');
    }

    const history = service.telemetryHistory();
    expect(history).toHaveLength(45);
    expect(history[0]?.errorRate5xxPercent).toBe(100);
    expect(history[history.length - 1]?.errorRate5xxPercent).toBe(0);
    expect(history[history.length - 1]?.p95LatencyMs).toBe(22);

    fetchSpy.mockRestore();
  });

  it('should expose targetServiceName targetCapabilities and targetSaturation signals', async () => {
    const service = new IncidentService();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: TargetHealthStatus.HEALTHY,
          service: 'billing-worker',
          version: 'v2.0.0',
          previousHealthyVersion: 'v1.9.9',
          capabilities: {
            chaosSimulation: false,
            healthyTrafficToggle: true
          },
          metrics: {
            requestsPerSecond: 19,
            errorRate5xxPercent: 0,
            p95LatencyMs: 32,
            healthyTrafficActive: false,
            saturation: {
              resourceLabel: 'Worker Queue',
              active: 5,
              waiting: 1,
              max: 16
            }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await service.fetchTargetStatus('http://localhost:8080');

    expect(service.targetServiceName()).toBe('billing-worker');
    expect(service.targetCapabilities()).toEqual({
      chaosSimulation: false,
      healthyTrafficToggle: true
    });
    expect(service.targetSaturation()).toEqual({
      resourceLabel: 'Worker Queue',
      active: 5,
      waiting: 1,
      max: 16
    });
    expect(service.telemetryHistory()[0]?.saturationResourceLabel).toBe('Worker Queue');

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: TargetHealthStatus.HEALTHY,
          service: 'stateless-api',
          version: 'v1.0.0',
          previousHealthyVersion: 'v1.0.0',
          capabilities: {
            chaosSimulation: false,
            healthyTrafficToggle: false
          },
          metrics: {
            requestsPerSecond: 40,
            errorRate5xxPercent: 0,
            p95LatencyMs: 12,
            healthyTrafficActive: false
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await service.fetchTargetStatus('http://localhost:8080');
    expect(service.targetSaturation()).toBeNull();
    expect(service.telemetryHistory()[1]?.saturationResourceLabel).toBeUndefined();

    fetchSpy.mockRestore();
  });

  it('should persist activeMode live across tabs only when authorized and default anonymous to replay', async () => {
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
      // 1. Authorized via liveDemoKey -> restores LIVE across new instance/tab
      const authorizedService = new IncidentService();
      authorizedService.setLiveDemoKey('valid-live-key');
      authorizedService.setActiveMode(IncidentExecutionMode.LIVE);
      expect(store.get('zeromttr_active_mode')).toBe(IncidentExecutionMode.LIVE);

      const newTabWithKey = new IncidentService();
      expect(newTabWithKey.activeMode()).toBe(IncidentExecutionMode.LIVE);

      // 2. Anonymous visitor without liveDemoKey and publicLiveDemo=false -> falls back safely to REPLAY
      store.delete('zeromttr_live_demo_key');
      const anonymousTab = new IncidentService();
      expect(anonymousTab.activeMode()).toBe(IncidentExecutionMode.REPLAY);

      // 3. Public live demo enabled -> restores LIVE once demo config confirms publicLiveDemo=true
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            publicLiveDemo: true,
            turnstileSiteKey: null,
            turnstileRequired: false
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await anonymousTab.fetchDemoConfig('http://localhost:8080');
      expect(anonymousTab.activeMode()).toBe(IncidentExecutionMode.LIVE);
      fetchSpy.mockRestore();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalStorage,
        configurable: true
      });
    }
  });
});
