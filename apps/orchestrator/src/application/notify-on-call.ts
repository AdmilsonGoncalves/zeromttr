import { isNonEmptyString, toErrorMessage } from '@zeromttr/utils';
import {
  DecisionAction,
  IncidentEventType,
  NotificationStatus,
  OrchestratorDefault,
  ReasoningProvider,
  TransitionReason
} from '../domain/incident-enums.js';
import { DecisionHmac } from '../domain/decision-hmac.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import type { ReasoningSource } from '../domain/rca-report.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { ToolsPort, SendPostMortemOutput } from '../ports/tools.port.js';
import type { Clock } from '../ports/clock.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

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
    private readonly dashboardUrl: string,
    private readonly logger?: LoggerPort,
    private readonly recipientEmail?: string
  ) {}

  /**
   * Generates signed HMAC decision links, emails the on-call engineer via Resend, and transitions to `NOTIFIED`.
   */
  public async execute(incidentId: string): Promise<NotifyOnCallResult> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    const exp = Math.floor(this.clock.now() / 1000) + 900; // 15 min TTL

    const approveAction = DecisionAction.APPROVE;
    const rejectAction = DecisionAction.REJECT;
    const approveSig = DecisionHmac.sign(incident.id, approveAction, exp, this.hmacSecret);
    const rejectSig = DecisionHmac.sign(incident.id, rejectAction, exp, this.hmacSecret);

    const approveUrl = `${this.dashboardUrl}/decision/${incident.id}#action=${approveAction}&sig=${approveSig}&exp=${exp}`;
    const rejectUrl = `${this.dashboardUrl}/decision/${incident.id}#action=${rejectAction}&sig=${rejectSig}&exp=${exp}`;

    const defaultReasoning: ReasoningSource = ReasoningProvider.LLM;
    let resendResult: SendPostMortemOutput;
    let isDegraded = false;
    let failureReason: string | undefined;

    try {
      resendResult = await this.tools.sendPostMortemResend({
        incident_id: incident.id,
        ...(isNonEmptyString(this.recipientEmail) ? { recipient_email: this.recipientEmail } : {}),
        title: `[Post-Mortem] Operational Incident ${incident.id} — ${incident.service}`,
        rca_summary: incident.rca?.summary || OrchestratorDefault.MITIGATION_FALLBACK,
        evidence_coverage: `${incident.rca?.signalsCollected ?? 4}/${incident.rca?.signalsTotal ?? 4} Signals (${incident.rca?.evidenceCoveragePercent ?? 100}%)`,
        reasoning_source: incident.rca?.reasoningSource || defaultReasoning,
        blast_radius: incident.rca?.blastRadius || [incident.service],
        regression_commit:
          incident.remediation?.suspectCommitSha ||
          incident.remediation?.commitSha ||
          OrchestratorDefault.UNKNOWN,
        pull_request_url: incident.remediation?.pullRequestUrl || process.env.TARGET_REPO_URL || '',
        approve_url: approveUrl,
        reject_url: rejectUrl,
        leaked_patterns_detected: incident.rca?.piiGuardAudit.leakedPatternsDetected ?? 0
      });
    } catch (err) {
      isDegraded = true;
      failureReason = toErrorMessage(err);
      this.logger?.warn({
        event: OrchestratorLogEvent.RESEND_NOTIFICATION_DEGRADED,
        incidentId: incident.id,
        message: failureReason
      });
      resendResult = {
        emailId: `email-fallback-${incident.id}`,
        sentAt: this.clock.iso()
      };
    }

    // Transition to NOTIFIED
    if (incident.state === IncidentState.AWAITING_PR) {
      const transitionReason = isDegraded
        ? `Post-mortem notification fallback (degraded: ${failureReason})`
        : TransitionReason.NOTIFIED_ON_CALL;
      const transition = incident.transition(IncidentState.NOTIFIED, transitionReason);
      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transition.from,
        to: transition.to,
        at: transition.at,
        reason: transition.reason
      });
    }

    const notificationStatus = isDegraded
      ? NotificationStatus.DEGRADED
      : NotificationStatus.DISPATCHED;

    incident.notification = {
      emailId: resendResult.emailId,
      status: notificationStatus,
      htmlPreview: isDegraded
        ? `Warning: Resend delivery failed (${failureReason}). Notification in degraded mode.`
        : 'Post-mortem notification dispatched to on-call engineer via Resend'
    };

    await this.repository.save(incident);

    // Broadcast SSE incident.notified WITHOUT secret HMAC signatures!
    this.broadcaster.broadcast(IncidentEventType.NOTIFIED, {
      incidentId: incident.id,
      emailId: resendResult.emailId,
      status: notificationStatus,
      htmlPreview: incident.notification.htmlPreview
    });

    return {
      emailId: resendResult.emailId,
      approveUrl,
      rejectUrl
    };
  }
}
