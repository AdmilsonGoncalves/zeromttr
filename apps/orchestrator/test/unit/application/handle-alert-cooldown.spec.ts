import { describe, expect, it, vi } from 'vitest';
import { FileIncidentRepository } from '../../../src/adapters/repo.file.js';
import { HandleAlert } from '../../../src/application/handle-alert.js';
import { IncidentState } from '../../../src/domain/incident-state.js';
import type { EventBroadcasterPort } from '../../../src/ports/event-broadcaster.port.js';

const FIRING_ALERT_PAYLOAD = {
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'HighPaymentErrorRate',
        service: 'api-pagamentos-core',
        severity: 'critical'
      }
    }
  ]
};

describe('HandleAlert rejection cooldown and repeat suppression', () => {
  it('should_suppress_new_incidents_during_rejectionCooldownSeconds_after_a_REJECTED_incident', async () => {
    const repository = new FileIncidentRepository();
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };
    let rejectionCooldownSeconds = 900;

    const handleAlert = new HandleAlert(repository, broadcaster, () => ({
      rejectionCooldownSeconds,
      repeatSuppressionSeconds: 0,
      decisionTtlSeconds: 900
    }));

    const first = await handleAlert.execute(FIRING_ALERT_PAYLOAD);
    expect(first.isDuplicate).toBe(false);
    expect(first.incident).not.toBeNull();

    // Advance incident through FSM to REJECTED
    const inc = first.incident!;
    inc.transition(IncidentState.INVESTIGATING, 'test');
    inc.transition(IncidentState.ENRICHING, 'test');
    inc.transition(IncidentState.REMEDIATING, 'test');
    inc.transition(IncidentState.AWAITING_PR, 'test');
    inc.transition(IncidentState.NOTIFIED, 'test');
    inc.transition(IncidentState.REJECTED, 'Human rejected hotfix');
    await repository.save(inc);

    // Firing alert arriving immediately should be suppressed by rejection cooldown
    const suppressed = await handleAlert.execute(FIRING_ALERT_PAYLOAD);
    expect(suppressed.isDuplicate).toBe(true);
    expect(suppressed.suppressed).toBe(true);
    expect(suppressed.suppressionReason).toBe('rejection_cooldown');
    expect(suppressed.incident?.id).toBe(inc.id);

    // Disabling cooldown dynamically allows opening a new incident
    rejectionCooldownSeconds = 0;
    const reopened = await handleAlert.execute(FIRING_ALERT_PAYLOAD);
    expect(reopened.isDuplicate).toBe(false);
    expect(reopened.suppressed).toBeUndefined();
    expect(reopened.incident?.id).not.toBe(inc.id);
  });

  it('should_suppress_reopening_after_RESOLVED_during_repeatSuppressionSeconds_window', async () => {
    const repository = new FileIncidentRepository();
    const broadcaster: EventBroadcasterPort = { broadcast: vi.fn() };

    const handleAlert = new HandleAlert(repository, broadcaster, () => ({
      rejectionCooldownSeconds: 0,
      repeatSuppressionSeconds: 300,
      decisionTtlSeconds: 900
    }));

    const first = await handleAlert.execute(FIRING_ALERT_PAYLOAD);
    const inc = first.incident!;
    inc.transition(IncidentState.INVESTIGATING, 'test');
    inc.transition(IncidentState.ENRICHING, 'test');
    inc.transition(IncidentState.REMEDIATING, 'test');
    inc.transition(IncidentState.AWAITING_PR, 'test');
    inc.transition(IncidentState.NOTIFIED, 'test');
    inc.transition(IncidentState.RESOLVED, 'Approved');
    await repository.save(inc);

    const suppressed = await handleAlert.execute(FIRING_ALERT_PAYLOAD);
    expect(suppressed.isDuplicate).toBe(true);
    expect(suppressed.suppressed).toBe(true);
    expect(suppressed.suppressionReason).toBe('repeat_suppression');
    expect(suppressed.incident?.id).toBe(inc.id);
  });
});
