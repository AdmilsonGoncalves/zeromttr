import { z } from 'zod';
import {
  IncidentDocSchema,
  IncidentEventType,
  IncidentNotificationSchema,
  IncidentStateSchema,
  PiiGuardAuditSchema,
  SpanNodeSchema
} from '../incident/incident.schema.js';
import { ReasoningSourceSchema } from '../llm/reasoning.schema.js';
import { FinOpsMetricsSchema } from '../tools/finops.schema.js';

export const ReplayTimelineEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal(IncidentEventType.CREATED),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.TRANSITION),
    state: IncidentStateSchema,
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.FINOPS),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.DOCS),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.RCA),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.REMEDIATION),
    delayMs: z.number().int().nonnegative()
  }),
  z.object({
    event: z.literal(IncidentEventType.NOTIFIED),
    delayMs: z.number().int().nonnegative()
  })
]);
export type ReplayTimelineEvent = z.infer<typeof ReplayTimelineEventSchema>;

/**
 * Snapshot persisted in data/last-recorded-incident.json for public Replay mode.
 */
export const ReplaySnapshotSchema = z.object({
  recordedAt: z.string(),
  incidentId: z.string().min(1),
  service: z.string().min(1),
  severity: z.string().min(1),
  evidenceCoverage: z.object({
    score: z.number().min(0).max(100),
    signalsCollected: z.number().int().nonnegative(),
    signalsTotal: z.number().int().positive(),
    signals: z.array(z.string())
  }),
  blastRadius: z.object({
    servicesInvolved: z.array(z.string())
  }),
  finops: FinOpsMetricsSchema,
  piiGuardAudit: PiiGuardAuditSchema,
  rca: z.object({
    summary: z.string().min(1),
    rootCause: z.string().min(1),
    reasoningSource: ReasoningSourceSchema,
    suspectFilePath: z.string().min(1),
    diagnosisSeconds: z.number().nonnegative().optional(),
    traceId: z.string().optional(),
    criticalSpan: z.string().optional(),
    spans: z.array(SpanNodeSchema).optional(),
    rawEdgeLogPreCollector: z.string().optional(),
    logSample: z.string().optional(),
    deployVersion: z.string().optional(),
    mitigations: z.array(z.string()).optional(),
    grafanaAnnotationId: z.number().int().optional()
  }),
  remediation: z.object({
    branchName: z.string().optional(),
    branchUrl: z.string().url(),
    pullRequestUrl: z.string().url(),
    commitSha: z.string().min(1),
    suspectCommitSha: z.string().optional()
  }),
  docs: z.array(IncidentDocSchema).optional(),
  notification: IncidentNotificationSchema.optional(),
  eventsTimeline: z.array(ReplayTimelineEventSchema).min(1)
});

export type ReplaySnapshot = z.infer<typeof ReplaySnapshotSchema>;
