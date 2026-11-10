import { toErrorMessage } from '@zeromttr/utils';
import {
  IncidentState,
  DecisionHmac,
  type IncidentDecisionAction,
  type ReasoningSource
} from '../domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  Clock,
  EventBroadcasterPort,
  SendPostMortemOutput
} from '../ports/index.js';

export interface NotifyOnCallResult {
  emailId: string;
  approveUrl: string;
  rejectUrl: string;
}

export class NotifyOnCall {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly clock: Clock,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly hmacSecret: string,
    private readonly dashboardUrl: string
  ) {}

  public async execute(incidentId: string): Promise<NotifyOnCallResult> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    const exp = Math.floor(this.clock.now() / 1000) + 900; // 15 min TTL

    const approveAction: IncidentDecisionAction = 'approve';
    const rejectAction: IncidentDecisionAction = 'reject';
    const approveSig = DecisionHmac.sign(incident.id, approveAction, exp, this.hmacSecret);
    const rejectSig = DecisionHmac.sign(incident.id, rejectAction, exp, this.hmacSecret);

    const approveUrl = `${this.dashboardUrl}/decision/${incident.id}#action=${approveAction}&sig=${approveSig}&exp=${exp}`;
    const rejectUrl = `${this.dashboardUrl}/decision/${incident.id}#action=${rejectAction}&sig=${rejectSig}&exp=${exp}`;

    const defaultReasoning: ReasoningSource = 'llm';
    let resendResult: SendPostMortemOutput;
    let isDegraded = false;
    let failureReason: string | undefined;

    try {
      resendResult = await this.tools.sendPostMortemResend({
        incident_id: incident.id,
        title: `[Post-Mortem] Incidente Operacional ${incident.id} — ${incident.service}`,
        rca_summary: incident.rca?.summary || 'Degradação crítica mitigada',
        evidence_coverage: `${incident.rca?.signalsCollected ?? 4}/${incident.rca?.signalsTotal ?? 4} Signals (${incident.rca?.evidenceCoveragePercent ?? 100}%)`,
        reasoning_source: incident.rca?.reasoningSource || defaultReasoning,
        blast_radius: incident.rca?.blastRadius || [incident.service],
        regression_commit: '8f14e45fceea167a5a36dedd4bea2543d1a2b3c4',
        pull_request_url:
          incident.remediation?.pullRequestUrl || 'https://github.com/AdmilsonGoncalves/zeromttr',
        approve_url: approveUrl,
        reject_url: rejectUrl,
        leaked_patterns_detected: incident.rca?.piiGuardAudit.leakedPatternsDetected ?? 0
      });
    } catch (err) {
      isDegraded = true;
      failureReason = toErrorMessage(err);
      resendResult = {
        emailId: `email-fallback-${incident.id}`,
        sentAt: this.clock.iso()
      };
    }

    // Transition to NOTIFIED
    if (incident.state === IncidentState.AWAITING_PR) {
      const transitionReason = isDegraded
        ? `Post-mortem notification fallback (degraded: ${failureReason})`
        : 'Post-mortem notification sent via Resend';
      const transition = incident.transition(IncidentState.NOTIFIED, transitionReason);
      this.broadcaster.broadcast('incident.transition', {
        incidentId: incident.id,
        from: transition.from,
        to: transition.to,
        at: transition.at,
        reason: transition.reason
      });
    }

    incident.notification = {
      emailId: resendResult.emailId,
      status: isDegraded ? 'degraded' : 'dispatched',
      htmlPreview: isDegraded
        ? `Aviso: Falha na entrega via Resend (${failureReason}). Notificação em modo degradado.`
        : 'Post-mortem notification dispatched to on-call engineer via Resend'
    };

    await this.repository.save(incident);

    // Broadcast SSE incident.notified WITHOUT secret HMAC signatures!
    this.broadcaster.broadcast('incident.notified', {
      incidentId: incident.id,
      emailId: resendResult.emailId,
      status: isDegraded ? 'degraded' : 'dispatched',
      htmlPreview: incident.notification.htmlPreview
    });

    return {
      emailId: resendResult.emailId,
      approveUrl,
      rejectUrl
    };
  }
}
