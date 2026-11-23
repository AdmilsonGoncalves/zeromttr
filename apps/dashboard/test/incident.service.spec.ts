import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
    expect(service.activeMode()).toBe('replay');
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
    expect(service.reasoningSource()).toBe('llm');
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
      service.setActiveMode('live');
      expect(service.activeMode()).toBe('live');

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
    service.setActiveMode('live');
    service.setLiveDemoKey('test-key');

    await service.triggerChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe('degraded');

    await service.resetChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe('healthy');

    await service.fetchIncidents(baseUrl);
    await service.simulateDecision('approve', baseUrl);

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

    await service.simulateDecision('approve', baseUrl);
    expect(service.currentIncident()?.decision).toBe('approve');
    expect(service.currentIncident()?.decisionSource).toBe('demo_simulation');
    expect(service.currentIncident()?.state).toBe('RESOLVED');
  });

  it('should submit HMAC decision and update decisionStatus', async () => {
    const service = new IncidentService();
    const validExp = Math.floor(Date.now() / 1000) + 3600;

    const ok = await service.submitDecision(
      'inc-20261110-001',
      {
        action: 'approve',
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
          JSON.stringify({ service: 'api-pagamentos-core', status: 'healthy', version: 'v2.14.7' }),
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
    incident.state = 'ENRICHING';
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

    incident.state = 'NOTIFIED';
    service.currentIncident.set({ ...incident });
    expect(service.fsmHintKey()).toBe('fsmHintNotified');
    expect(service.isWorkflowRunning()).toBe(false);
    expect(service.fsmStages()[6]?.status).toBe('active');

    incident.state = 'RESOLVED';
    service.currentIncident.set({ ...incident });
    expect(service.fsmHintKey()).toBe('fsmHintResolved');
    expect(service.isWorkflowRunning()).toBe(false);
    expect(service.fsmStages().every((stage) => stage.status === 'completed')).toBe(true);
  });
});
