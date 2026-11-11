import { describe, it, expect, vi } from 'vitest';
import { NotifyOnCall } from '../../../src/application/index.js';
import { IncidentState, Incident } from '../../../src/domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  Clock,
  EventBroadcasterPort
} from '../../../src/ports/index.js';

describe('NotifyOnCall Use Case', () => {
  it('should send post-mortem via Resend with HMAC links in fragment, transition to NOTIFIED, and NEVER leak sig in SSE', async () => {
    const incident = new Incident({
      id: 'inc-test-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.AWAITING_PR,
      remediation: {
        branchUrl:
          'https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-inc-test-001',
        pullRequestUrl: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/42',
        commitSha: 'commit123456'
      }
    });

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
      sendPostMortemResend: vi.fn(async () => ({
        emailId: 'email-resend-999',
        sentAt: '2026-11-10T12:00:00.000Z'
      })),
      annotateGrafanaIncident: vi.fn()
    };

    const clock: Clock = {
      now: vi.fn(() => 1730000000000), // ms
      iso: vi.fn(() => '2026-11-10T12:00:00.000Z')
    };

    const broadcaster: EventBroadcasterPort = {
      broadcast: vi.fn()
    };

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
    const broadcastCalls = (broadcaster.broadcast as any).mock.calls;
    const notifiedCall = broadcastCalls.find((call: any[]) => call[0] === 'incident.notified');
    expect(notifiedCall).toBeDefined();
    const payload = notifiedCall[1];
    expect(payload.sig).toBeUndefined();
    expect(payload.approveSig).toBeUndefined();
    expect(payload.rejectSig).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('sig=');

    expect(result.emailId).toBe('email-resend-999');
  });
});
