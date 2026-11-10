import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

  it('should toggle active mode and demo key', () => {
    const service = new IncidentService();
    service.setActiveMode('live');
    expect(service.activeMode()).toBe('live');

    service.setLiveDemoKey('secret-demo-token');
    expect(service.liveDemoKey()).toBe('secret-demo-token');
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

  it('should trigger chaos and reset via server', async () => {
    const service = new IncidentService();
    service.setActiveMode('live');
    service.setLiveDemoKey('test-key');

    await service.triggerChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe('degraded');

    await service.resetChaos(baseUrl);
    expect(service.targetStatus()?.status).toBe('healthy');
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
});
