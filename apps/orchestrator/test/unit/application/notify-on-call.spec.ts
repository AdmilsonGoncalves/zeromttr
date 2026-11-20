import { describe, it, expect, vi } from 'vitest';
import { isObject } from '@zeromttr/utils';
import { NotifyOnCall } from '../../../src/application/index.js';
import {
  AlertSeverity,
  IncidentEventType,
  IncidentState,
  Incident
} from '../../../src/domain/index.js';
import {
  createMockBroadcaster,
  createMockClock,
  createMockIncidentRepository,
  createMockToolsPort
} from '../../helpers/test-doubles.helper.js';

describe('NotifyOnCall Use Case', () => {
  it('should send post-mortem via Resend with HMAC links in fragment, transition to NOTIFIED, and NEVER leak sig in SSE', async () => {
    const incident = new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.AWAITING_PR,
      remediation: {
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
        commitSha: 'commit123456'
      }
    });

    const repo = createMockIncidentRepository([incident]);
    const tools = createMockToolsPort({
      sendPostMortemResend: vi.fn(async () => ({
        emailId: 'email-resend-999',
        sentAt: '2026-11-10T12:00:00.000Z'
      }))
    });
    const clock = createMockClock();
    const broadcaster = createMockBroadcaster();

    const hmacSecret = 'test-secret-key-123';
    const dashboardUrl = 'https://zeromttr.agjworks.com';

    const useCase = new NotifyOnCall(repo, tools, clock, broadcaster, hmacSecret, dashboardUrl);

    const result = await useCase.execute(incident.id);

    expect(incident.state).toBe(IncidentState.NOTIFIED);
    expect(tools.sendPostMortemResend).toHaveBeenCalledWith(
      expect.objectContaining({
        approve_url: expect.stringMatching(/#action=approve&sig=[a-f0-9]{64}&exp=\d+/),
        reject_url: expect.stringMatching(/#action=reject&sig=[a-f0-9]{64}&exp=\d+/)
      })
    );

    // Verify SSE incident.notified event
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      'incident.notified',
      expect.objectContaining({
        incidentId: incident.id,
        emailId: 'email-resend-999'
      })
    );

    // CRITICAL: Ensure approveSig, rejectSig, or sig are NOT present in broadcast
    const notifiedCall = broadcaster.broadcast.mock.calls.find(
      (call) => call[0] === IncidentEventType.NOTIFIED
    );
    expect(notifiedCall).toBeDefined();
    const payload = notifiedCall?.[1];
    expect(isObject(payload)).toBe(true);
    if (!isObject(payload)) {
      throw new Error('Expected broadcast payload object');
    }
    expect(payload.sig).toBeUndefined();
    expect(payload.approveSig).toBeUndefined();
    expect(payload.rejectSig).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('sig=');

    expect(result.emailId).toBe('email-resend-999');
  });

  const createRecipientHarness = (recipientEmail?: string) => {
    const incident = new Incident({
      id: 'inc-test-recipient',
      service: 'api-pagamentos-core',
      severity: AlertSeverity.CRITICAL,
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.AWAITING_PR,
      remediation: {
        branchUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/43',
        commitSha: 'commit999'
      }
    });
    const repo = createMockIncidentRepository([incident]);
    const sendPostMortemResend = vi.fn(async () => ({
      emailId: 'email-resend-recipient',
      sentAt: '2026-11-10T12:00:00.000Z'
    }));
    const tools = createMockToolsPort({ sendPostMortemResend });
    const useCase = new NotifyOnCall(
      repo,
      tools,
      createMockClock(),
      createMockBroadcaster(),
      'test-secret-key-123',
      'https://zeromttr.agjworks.com',
      undefined,
      recipientEmail
    );
    return { incident, sendPostMortemResend, useCase };
  };

  it('should forward recipient_email when configured', async () => {
    const { incident, sendPostMortemResend, useCase } =
      createRecipientHarness('sre-oncall@example.com');

    await useCase.execute(incident.id);

    expect(sendPostMortemResend).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_email: 'sre-oncall@example.com'
      })
    );
  });

  it('should omit recipient_email when blank', async () => {
    const { incident, sendPostMortemResend, useCase } = createRecipientHarness('   ');

    await useCase.execute(incident.id);

    expect(sendPostMortemResend).toHaveBeenCalledWith(
      expect.not.objectContaining({
        recipient_email: expect.anything()
      })
    );
  });
});
