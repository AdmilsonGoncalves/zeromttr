import { describe, it, expect, vi } from 'vitest';
import { RecordDecision } from '../../../src/application/record-decision.js';
import {
  InvalidDecisionSignatureError,
  IncidentAlreadyResolvedError
} from '../../../src/application/decision-helpers.js';
import { SimulateDemoDecision } from '../../../src/demo/simulate-demo-decision.js';
import {
  AlertSeverity,
  DecisionAction,
  DecisionSource
} from '../../../src/domain/incident-enums.js';
import { DecisionHmac } from '../../../src/domain/decision-hmac.js';
import { Incident } from '../../../src/domain/incident.js';
import { IncidentState } from '../../../src/domain/incident-state.js';
import type { IncidentRepository } from '../../../src/ports/incident-repository.port.js';
import type { ToolsPort } from '../../../src/ports/tools.port.js';
import type { Clock } from '../../../src/ports/clock.port.js';
import type { EventBroadcasterPort } from '../../../src/ports/event-broadcaster.port.js';
import { createMockToolsPort } from '../../helpers/test-doubles.helper.js';

describe('RecordDecision & SimulateDemoDecision Use Cases', () => {
  const secret = 'test-secret-hmac-key';
  const incidentId = 'inc-test-001';
  const now = 1730000000;
  const exp = now + 900;

  const createMockIncident = (state: IncidentState = IncidentState.NOTIFIED) =>
    new Incident({
      id: incidentId,
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
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
    const tools = createMockToolsPort();
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);

    await expect(
      useCase.execute(incidentId, DecisionAction.APPROVE, 'bad-sig', exp)
    ).rejects.toThrow(InvalidDecisionSignatureError);
  });

  it('should reject second decision when incident is already in RESOLVED or REJECTED state with 409 Conflict', async () => {
    const incident = createMockIncident(IncidentState.RESOLVED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };
    const tools = createMockToolsPort();
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);
    const sig = DecisionHmac.sign(incidentId, DecisionAction.APPROVE, exp, secret);

    await expect(useCase.execute(incidentId, DecisionAction.APPROVE, sig, exp)).rejects.toThrow(
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
    const tools = createMockToolsPort();
    const clock: Clock = { now: () => now * 1000, iso: () => '' };
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new RecordDecision(repo, tools, clock, broadcaster, secret);
    const simUseCase = new SimulateDemoDecision(repo, tools, broadcaster);
    const sig = DecisionHmac.sign(incidentId, DecisionAction.APPROVE, exp, secret);

    await expect(useCase.execute(incidentId, DecisionAction.APPROVE, sig, exp)).rejects.toThrow();
    await expect(simUseCase.execute(incidentId, DecisionAction.APPROVE)).rejects.toThrow();
  });

  it('should allow SimulateDemoDecision for demo mode without HMAC signature', async () => {
    const incident = createMockIncident(IncidentState.NOTIFIED);
    const repo: IncidentRepository = {
      findById: vi.fn(async () => incident),
      findOpenByFingerprint: vi.fn(async () => null),
      findAll: vi.fn(async () => [incident]),
      save: vi.fn(async () => {})
    };

    const tools: ToolsPort = createMockToolsPort({
      annotateGrafanaIncident: vi.fn(async () => ({ annotationId: 202, success: true }))
    });

    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const useCase = new SimulateDemoDecision(repo, tools, broadcaster);
    const result = await useCase.execute(incidentId, DecisionAction.REJECT);

    expect(result.state).toBe(IncidentState.REJECTED);
    expect(result.decision).toBe(DecisionAction.REJECT);
    expect(result.decisionSource).toBe(DecisionSource.DEMO_SIMULATION);
  });
});
