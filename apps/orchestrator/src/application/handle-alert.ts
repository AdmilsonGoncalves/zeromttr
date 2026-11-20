import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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
    annotations: z.record(z.unknown()).optional(),
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

export interface HandleAlertResult {
  incident: Incident | null;
  isDuplicate: boolean;
  ignored?: boolean;
}

export class HandleAlert {
  private readonly inFlightFingerprints = new Map<string, Promise<HandleAlertResult>>();

  public constructor(
    private readonly repository: IncidentRepository,
    private readonly broadcaster: EventBroadcasterPort
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

  private async processFiringAlert(
    primaryAlert: GrafanaWebhookPayload['alerts'][number],
    fingerprint: string
  ): Promise<HandleAlertResult> {
    const existing = await this.repository.findOpenByFingerprint(fingerprint);
    if (existing) {
      const lastTransition = existing.transitions[existing.transitions.length - 1];
      const lastReferenceAt = lastTransition ? lastTransition.at : existing.startedAt;
      const elapsedSeconds = diffInSeconds(lastReferenceAt, Date.now());
      const ttlSeconds = 15 * 60;

      if (elapsedSeconds > ttlSeconds) {
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
      } else {
        return {
          incident: existing,
          isDuplicate: true
        };
      }
    }

    const incidentId = `inc-${randomUUID().slice(0, 8)}`;
    const severity = isNonEmptyString(primaryAlert.labels.severity)
      ? primaryAlert.labels.severity
      : AlertSeverity.CRITICAL;
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
}
