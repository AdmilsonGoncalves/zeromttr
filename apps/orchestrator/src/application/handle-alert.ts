import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SystemSettings } from '@zeromttr/contracts';
import { diffInSeconds, isNonEmptyString } from '@zeromttr/utils';
import {
  AlertSeverity,
  GrafanaAlertStatus,
  IncidentEventType,
  IncidentExecutionMode,
  TransitionReason
} from '../domain/incident-enums.js';
import { Incident, type IncidentMode } from '../domain/incident.js';
import { IncidentState } from '../domain/incident-state.js';
import { computeAlertFingerprint } from '../domain/fingerprint.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';

export const GrafanaAlertItemSchema = z
  .object({
    status: z.string().optional(),
    labels: z
      .object({
        alertname: z.string().min(1),
        service: z.string().min(1),
        severity: z.string().optional().default(AlertSeverity.CRITICAL)
      })
      .passthrough(),
    annotations: z.record(z.string(), z.unknown()).optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    fingerprint: z.string().optional()
  })
  .passthrough();

export const GrafanaWebhookPayloadSchema = z
  .object({
    receiver: z.string().optional(),
    status: z.string().optional(),
    alerts: z.array(GrafanaAlertItemSchema).min(1)
  })
  .passthrough();

export type GrafanaWebhookPayload = z.infer<typeof GrafanaWebhookPayloadSchema>;

export type AlertSuppressionReason = 'rejection_cooldown' | 'repeat_suppression';

export interface HandleAlertResult {
  incident: Incident | null;
  isDuplicate: boolean;
  ignored?: boolean;
  suppressed?: boolean;
  suppressionReason?: AlertSuppressionReason;
}

export type AlertPolicySettings = Pick<
  SystemSettings,
  'rejectionCooldownSeconds' | 'repeatSuppressionSeconds' | 'decisionTtlSeconds'
>;

const DEFAULT_DECISION_TTL_SECONDS = 15 * 60;
const WARNING_SEVERITY_ALIASES: ReadonlySet<string> = new Set([AlertSeverity.WARNING, 'warn']);

interface ResolvedAlertPolicy {
  ttlSeconds: number;
  rejectionCooldownSeconds: number;
  repeatSuppressionSeconds: number;
}

type OpenIncidentReconciliation =
  { status: 'duplicate'; result: HandleAlertResult } | { status: 'expired' } | { status: 'none' };

function normalizeAlertSeverity(rawSeverity?: string): AlertSeverity {
  if (isNonEmptyString(rawSeverity)) {
    const normalized = rawSeverity.trim().toLowerCase();
    if (WARNING_SEVERITY_ALIASES.has(normalized)) {
      return AlertSeverity.WARNING;
    }
  }
  return AlertSeverity.CRITICAL;
}

function getLastActivityAt(incident: Incident): string {
  const lastTransition = incident.transitions[incident.transitions.length - 1];
  return lastTransition ? lastTransition.at : incident.startedAt;
}

function isOpenIncidentExpired(incident: Incident, nowMs: number, ttlSeconds: number): boolean {
  const issuedExpiresAtMs =
    incident.state === IncidentState.NOTIFIED && incident.notification?.decisionExpiresAt
      ? Date.parse(incident.notification.decisionExpiresAt)
      : NaN;
  if (Number.isFinite(issuedExpiresAtMs)) {
    return nowMs > issuedExpiresAtMs;
  }

  const elapsedSeconds = diffInSeconds(getLastActivityAt(incident), nowMs);
  return elapsedSeconds > ttlSeconds;
}

function evaluateSuppressionReason(
  latest: Incident,
  nowMs: number,
  policy: ResolvedAlertPolicy
): AlertSuppressionReason | null {
  const elapsedSeconds = diffInSeconds(getLastActivityAt(latest), nowMs);

  if (
    latest.state === IncidentState.REJECTED &&
    policy.rejectionCooldownSeconds > 0 &&
    elapsedSeconds < policy.rejectionCooldownSeconds
  ) {
    return 'rejection_cooldown';
  }

  const isConclusiveState =
    latest.state === IncidentState.RESOLVED || latest.state === IncidentState.REJECTED;
  if (
    isConclusiveState &&
    policy.repeatSuppressionSeconds > 0 &&
    elapsedSeconds < policy.repeatSuppressionSeconds
  ) {
    return 'repeat_suppression';
  }

  return null;
}

/**
 * Use case ingesting Grafana alert webhooks with fingerprint deduplication and concurrency coalescing.
 */
export class HandleAlert {
  private readonly inFlightFingerprints = new Map<string, Promise<HandleAlertResult>>();

  public constructor(
    private readonly repository: IncidentRepository,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly getAlertSettings?: () => AlertPolicySettings
  ) {}

  /**
   * Parses Grafana webhook alerts, ignores resolved notices, deduplicates active fingerprints, and creates an incident.
   */
  public async execute(rawPayload: unknown): Promise<HandleAlertResult> {
    const payload = GrafanaWebhookPayloadSchema.parse(rawPayload);
    const primaryAlert = payload.alerts[0];

    const isResolvedNotification =
      payload.status?.toLowerCase() === GrafanaAlertStatus.RESOLVED ||
      payload.alerts.every((alert) => alert.status?.toLowerCase() === GrafanaAlertStatus.RESOLVED);
    if (isResolvedNotification) {
      return {
        incident: null,
        isDuplicate: false,
        ignored: true
      };
    }

    const fingerprint = computeAlertFingerprint(primaryAlert.labels);
    const pending = this.inFlightFingerprints.get(fingerprint);
    if (pending) {
      const firstResult = await pending;
      return {
        incident: firstResult.incident,
        isDuplicate: true
      };
    }

    const operation = this.processFiringAlert(primaryAlert, fingerprint).finally(() => {
      this.inFlightFingerprints.delete(fingerprint);
    });
    this.inFlightFingerprints.set(fingerprint, operation);
    return operation;
  }

  private resolvePolicy(): ResolvedAlertPolicy {
    const policy = this.getAlertSettings?.();
    return {
      ttlSeconds: policy?.decisionTtlSeconds ?? DEFAULT_DECISION_TTL_SECONDS,
      rejectionCooldownSeconds: policy?.rejectionCooldownSeconds ?? 0,
      repeatSuppressionSeconds: policy?.repeatSuppressionSeconds ?? 0
    };
  }

  private async reconcileOpenIncident(
    fingerprint: string,
    policy: ResolvedAlertPolicy,
    nowMs: number
  ): Promise<OpenIncidentReconciliation> {
    const existing = await this.repository.findOpenByFingerprint(fingerprint);
    if (!existing) {
      return { status: 'none' };
    }

    if (!isOpenIncidentExpired(existing, nowMs, policy.ttlSeconds)) {
      return {
        status: 'duplicate',
        result: {
          incident: existing,
          isDuplicate: true
        }
      };
    }

    const reason =
      existing.state === IncidentState.NOTIFIED
        ? TransitionReason.DECISION_TTL_EXPIRED
        : TransitionReason.STALE_PROCESSING_TIMEOUT;
    const transition = existing.transition(IncidentState.FAILED, reason);
    await this.repository.save(existing);
    this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
      incidentId: existing.id,
      from: transition.from,
      to: transition.to,
      at: transition.at,
      reason: transition.reason
    });
    return { status: 'expired' };
  }

  private async checkRecentSuppression(
    fingerprint: string,
    policy: ResolvedAlertPolicy,
    nowMs: number
  ): Promise<HandleAlertResult | null> {
    if (
      (policy.rejectionCooldownSeconds <= 0 && policy.repeatSuppressionSeconds <= 0) ||
      !this.repository.findLatestByFingerprint
    ) {
      return null;
    }

    const latest = await this.repository.findLatestByFingerprint(fingerprint);
    if (!latest) {
      return null;
    }

    const suppressionReason = evaluateSuppressionReason(latest, nowMs, policy);
    if (!suppressionReason) {
      return null;
    }

    return {
      incident: latest,
      isDuplicate: true,
      suppressed: true,
      suppressionReason
    };
  }

  private async createAndPublishIncident(
    primaryAlert: GrafanaWebhookPayload['alerts'][number],
    fingerprint: string
  ): Promise<HandleAlertResult> {
    const incidentId = `inc-${randomUUID().slice(0, 8)}`;
    const severity = normalizeAlertSeverity(primaryAlert.labels.severity);
    const mode: IncidentMode = IncidentExecutionMode.LIVE;

    const incident = new Incident({
      id: incidentId,
      service: primaryAlert.labels.service,
      severity,
      fingerprint,
      alertName: primaryAlert.labels.alertname,
      mode
    });

    await this.repository.save(incident);

    this.broadcaster.broadcast(IncidentEventType.CREATED, {
      incidentId: incident.id,
      service: incident.service,
      severity: incident.severity,
      mode: incident.mode,
      at: incident.startedAt
    });

    return {
      incident,
      isDuplicate: false
    };
  }

  private async processFiringAlert(
    primaryAlert: GrafanaWebhookPayload['alerts'][number],
    fingerprint: string
  ): Promise<HandleAlertResult> {
    const policy = this.resolvePolicy();
    const nowMs = Date.now();

    const openReconciliation = await this.reconcileOpenIncident(fingerprint, policy, nowMs);
    if (openReconciliation.status === 'duplicate') {
      return openReconciliation.result;
    }

    if (openReconciliation.status === 'none') {
      const suppressed = await this.checkRecentSuppression(fingerprint, policy, nowMs);
      if (suppressed) {
        return suppressed;
      }
    }

    return this.createAndPublishIncident(primaryAlert, fingerprint);
  }
}
