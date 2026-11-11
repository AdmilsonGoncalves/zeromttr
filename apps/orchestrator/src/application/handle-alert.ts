import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isNonEmptyString } from '@zeromttr/utils';
import {
  Incident,
  IncidentState,
  computeAlertFingerprint,
  type IncidentMode
} from '../domain/index.js';
import type { IncidentRepository, EventBroadcasterPort } from '../ports/index.js';

export const GrafanaAlertItemSchema = z
  .object({
    status: z.string().optional(),
    labels: z
      .object({
        alertname: z.string().min(1),
        service: z.string().min(1),
        severity: z.string().optional().default('critical')
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
  incident: Incident;
  isDuplicate: boolean;
}

export class HandleAlert {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly broadcaster: EventBroadcasterPort
  ) {}

  public async execute(rawPayload: unknown): Promise<HandleAlertResult> {
    const payload = GrafanaWebhookPayloadSchema.parse(rawPayload);
    const primaryAlert = payload.alerts[0];
    const fingerprint = computeAlertFingerprint(primaryAlert.labels);

    const existing = await this.repository.findOpenByFingerprint(fingerprint);
    if (existing) {
      const now = Date.now();
      const lastTransition = existing.transitions[existing.transitions.length - 1];
      const lastTimestamp = lastTransition
        ? new Date(lastTransition.at).getTime()
        : new Date(existing.startedAt).getTime();
      const elapsedMs = now - lastTimestamp;
      const ttlMs = 15 * 60 * 1000;

      if (elapsedMs > ttlMs) {
        const reason =
          existing.state === IncidentState.NOTIFIED
            ? 'Incident decision TTL expired without action'
            : 'Stale incident processing timed out';
        const transition = existing.transition(IncidentState.FAILED, reason);
        await this.repository.save(existing);
        this.broadcaster.broadcast('incident.transition', {
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
      : 'critical';
    const mode: IncidentMode = 'live';

    const incident = new Incident({
      id: incidentId,
      service: primaryAlert.labels.service,
      severity,
      fingerprint,
      alertName: primaryAlert.labels.alertname,
      mode
    });

    await this.repository.save(incident);

    this.broadcaster.broadcast('incident.created', {
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
