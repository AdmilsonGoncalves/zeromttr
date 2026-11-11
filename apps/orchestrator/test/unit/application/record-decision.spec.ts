import { describe, it, expect, vi } from 'vitest';
import {
  RecordDecision,
  InvalidDecisionSignatureError,
  IncidentAlreadyResolvedError
} from '../../../src/application/index.js';
import { IncidentState, Incident, DecisionHmac } from '../../../src/domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  Clock,
  EventBroadcasterPort
} from '../../../src/ports/index.js';

describe('RecordDecision Use Case', () => {
  const secret = 'test-secret-hmac-key';
  const incidentId = 'inc-test-001';
  const now = 1730000000;
  const exp = now + 900;

  const createMockIncident = (state: IncidentState = IncidentState.NOTIFIED) =>
    new Incident({
      id: incidentId,
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state
    });

  it('should validate HMAC signature, transition NOTIFIED to RESOLVED on approve, annotate Grafana and emit events', async () => {
    const incident = createMockIncident(IncidentState.NOTIFIED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 201, success: true }))
    };

    const clock: Clock = {
      now: vi.fn(() => now * 1000),
      iso: vi.fn(() => '2026-11-10T12:00:00.000Z')
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);

    const sig = DecisionHmac.sign(incidentId, 'approve', exp, secret);
    const result = await useCase.execute(incidentId, 'approve', sig, exp);

    expect(result.state).toBe(IncidentState.RESOLVED);
    expect(result.decision).toBe('approve');
    expect(result.decisionSource).toBe('email_hmac');
    expect(tools.annotateGrafanaIncident).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('RESOLVED') })
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.decision',
      expect.objectContaining({ incidentId, action: 'approve', source: 'email_hmac' })
    );
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.transition',
      expect.objectContaining({ to: IncidentState.RESOLVED })
    );
  });

  it('should reject invalid or expired signature with InvalidDecisionSignatureError', async () => {
    const incident = createMockIncident(IncidentState.NOTIFIED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools = {} as ToolsPort;
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);

    await expect(useCase.execute(incidentId, 'approve', 'bad-sig', exp)).rejects.toThrow(
      InvalidDecisionSignatureError
    );
  });

  it('should reject second decision when incident is already in RESOLVED or REJECTED state with 409 Conflict', async () => {
    const incident = createMockIncident(IncidentState.RESOLVED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools = {} as ToolsPort;
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);
    const sig = DecisionHmac.sign(incidentId, 'approve', exp, secret);

    await expect(useCase.execute(incidentId, 'approve', sig, exp)).rejects.toThrow(
      IncidentAlreadyResolvedError
    );
  });

  it('should throw IncidentNotFoundError when trying to record decision for non-existent incident', async () => {
    const repo: IncidentRepository = {
      findById: vi.fn(async () => null),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      save: vi.fn(async () => {})
    };
    const tools = {} as ToolsPort;
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);
    const sig = DecisionHmac.sign(incidentId, 'approve', exp, secret);

    await expect(useCase.execute(incidentId, 'approve', sig, exp)).rejects.toThrow();
    await expect(useCase.executeSimulated(incidentId, 'approve')).rejects.toThrow();
  });

  it('should allow simulate-decision for demo mode without HMAC signature', async () => {
    const incident = createMockIncident(IncidentState.NOTIFIED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = {
      executePromqlRange: vi.fn(),
      queryLokiLogs: vi.fn(),
      analyzeOtelTrace: vi.fn(),
      searchTracesByTraceQL: vi.fn(),
      inspectGitDeployDiff: vi.fn(),
      createRemediationPr: vi.fn(),
      sendPostMortemResend: vi.fn(),
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 202, success: true }))
    };

    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);
    const result = await useCase.executeSimulated(incidentId, 'reject');

    expect(result.state).toBe(IncidentState.REJECTED);
    expect(result.decision).toBe('reject');
    expect(result.decisionSource).toBe('demo_simulation');
  });
});
