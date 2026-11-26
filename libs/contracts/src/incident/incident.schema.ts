import { z } from 'zod';
import { ReasoningProvider, ReasoningSourceSchema } from '../llm/reasoning.schema.js';

export const IncidentState = {
  RECEIVED: 'RECEIVED',
  INVESTIGATING: 'INVESTIGATING',
  ENRICHING: 'ENRICHING',
  REMEDIATING: 'REMEDIATING',
  AWAITING_PR: 'AWAITING_PR',
  NOTIFIED: 'NOTIFIED',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED'
} as const;
export type IncidentState = (typeof IncidentState)[keyof typeof IncidentState];
export const IncidentStateSchema = z.nativeEnum(IncidentState);

export const IncidentEventType = {
  CREATED: 'incident.created',
  TRANSITION: 'incident.transition',
  FINOPS: 'incident.finops',
  DOCS: 'incident.docs',
  RCA: 'incident.rca',
  REMEDIATION: 'incident.remediation',
  NOTIFIED: 'incident.notified',
  DECISION: 'incident.decision'
} as const;
export type IncidentEventType = (typeof IncidentEventType)[keyof typeof IncidentEventType];
export const IncidentEventTypeSchema = z.nativeEnum(IncidentEventType);

export const TargetHealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNREACHABLE: 'unreachable'
} as const;
export type TargetHealthStatus = (typeof TargetHealthStatus)[keyof typeof TargetHealthStatus];
export const TargetHealthStatusSchema = z.nativeEnum(TargetHealthStatus);

export const NotificationStatus = {
  DISPATCHED: 'dispatched',
  DEGRADED: 'degraded'
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];
export const NotificationStatusSchema = z.nativeEnum(NotificationStatus);

export const DecisionAction = {
  APPROVE: 'approve',
  REJECT: 'reject'
} as const;
export type DecisionAction = (typeof DecisionAction)[keyof typeof DecisionAction];
export type IncidentDecisionAction = DecisionAction;
export const DecisionActionSchema = z.nativeEnum(DecisionAction);

export const DecisionSource = {
  EMAIL_HMAC: 'email_hmac',
  DEMO_SIMULATION: 'demo_simulation'
} as const;
export type DecisionSource = (typeof DecisionSource)[keyof typeof DecisionSource];
export type IncidentDecisionSource = DecisionSource;
export const DecisionSourceSchema = z.nativeEnum(DecisionSource);

export const IncidentExecutionMode = {
  LIVE: 'live',
  REPLAY: 'replay'
} as const;
export type IncidentExecutionMode =
  (typeof IncidentExecutionMode)[keyof typeof IncidentExecutionMode];
export type IncidentMode = IncidentExecutionMode;
export const IncidentModeSchema = z.nativeEnum(IncidentExecutionMode);

export const AlertSeverity = {
  CRITICAL: 'critical',
  WARNING: 'warning'
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];
export const AlertSeveritySchema = z.nativeEnum(AlertSeverity);

export const SpanNodeSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  serviceName: z.string(),
  operationName: z.string(),
  durationMs: z.number(),
  hasError: z.boolean(),
  errorMessage: z.string().optional()
});
export type SpanNode = z.infer<typeof SpanNodeSchema>;

export const PiiGuardAuditSchema = z.object({
  leakedPatternsDetected: z.number().int().nonnegative(),
  detectedTypes: z.array(z.string()),
  edgeRedactedTokensVerified: z.number().int().nonnegative(),
  passed: z.boolean()
});
export type PiiGuardAudit = z.infer<typeof PiiGuardAuditSchema>;

export const EvidenceBreakdownSchema = z.object({
  promql: z.number(),
  exemplar: z.number(),
  tempoSpan: z.number(),
  lokiAndDiff: z.number()
});
export type EvidenceBreakdown = z.infer<typeof EvidenceBreakdownSchema>;

export const IncidentTransitionSchema = z.object({
  from: IncidentStateSchema.nullable(),
  to: IncidentStateSchema,
  at: z.string(),
  reason: z.string().optional()
});
export type IncidentTransition = z.infer<typeof IncidentTransitionSchema>;

export const IncidentRcaSchema = z.object({
  summary: z.string(),
  rootCause: z.string().optional(),
  reasoningSource: ReasoningSourceSchema.default(ReasoningProvider.LLM),
  evidenceCoveragePercent: z.number(),
  signalsCollected: z.number().int().nonnegative(),
  signalsTotal: z.number().int().positive(),
  evidenceBreakdown: EvidenceBreakdownSchema.optional(),
  blastRadius: z.array(z.string()),
  diagnosisSeconds: z.number().nonnegative(),
  traceId: z.string(),
  criticalSpan: z.string(),
  spans: z.array(SpanNodeSchema),
  rawEdgeLogPreCollector: z.string().optional(),
  logSample: z.string(),
  piiGuardAudit: PiiGuardAuditSchema,
  deployVersion: z.string().optional(),
  mitigations: z.array(z.string()),
  grafanaAnnotationId: z.number().int().optional()
});
export type IncidentRca = z.infer<typeof IncidentRcaSchema>;

export const IncidentFinopsSchema = z.object({
  rawBytesFetched: z.number().int().nonnegative(),
  compactedBytesSent: z.number().int().nonnegative(),
  payloadReductionPercent: z.number().min(0).max(100),
  estimatedTokensSaved: z.number().int().nonnegative()
});
export type IncidentFinops = z.infer<typeof IncidentFinopsSchema>;

export const IncidentDocSchema = z.object({
  url: z.string(),
  title: z.string(),
  markdownExcerpt: z.string()
});
export type IncidentDoc = z.infer<typeof IncidentDocSchema>;

export const IncidentRemediationSchema = z.object({
  branchName: z.string().optional(),
  branchUrl: z.string(),
  pullRequestUrl: z.string().optional(),
  commitSha: z.string().optional(),
  suspectCommitSha: z.string().optional()
});
export type IncidentRemediation = z.infer<typeof IncidentRemediationSchema>;

export const IncidentNotificationSchema = z.object({
  emailId: z.string(),
  htmlPreview: z.string().optional(),
  status: NotificationStatusSchema.optional()
});
export type IncidentNotification = z.infer<typeof IncidentNotificationSchema>;

export const IncidentSummarySchema = z.object({
  id: z.string(),
  service: z.string(),
  severity: AlertSeveritySchema,
  state: IncidentStateSchema,
  mode: IncidentModeSchema.optional(),
  startedAt: z.string()
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

export const IncidentDetailSchema = IncidentSummarySchema.extend({
  fingerprint: z.string().optional(),
  alertName: z.string().optional(),
  transitions: z.array(IncidentTransitionSchema),
  rca: IncidentRcaSchema.optional(),
  finops: IncidentFinopsSchema.optional(),
  docs: z.array(IncidentDocSchema).optional(),
  remediation: IncidentRemediationSchema.optional(),
  notification: IncidentNotificationSchema.optional(),
  decision: DecisionActionSchema.optional(),
  decisionSource: DecisionSourceSchema.optional()
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export const TargetCapabilitiesSchema = z.object({
  chaosSimulation: z.boolean().default(false),
  healthyTrafficToggle: z.boolean().default(false)
});
export type TargetCapabilities = z.infer<typeof TargetCapabilitiesSchema>;

export const TargetSaturationSchema = z.object({
  resourceLabel: z.string().min(1),
  active: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  max: z.number().int().nonnegative()
});
export type TargetSaturation = z.infer<typeof TargetSaturationSchema>;

export const TargetLiveMetricsSchema = z.object({
  requestsPerSecond: z.number().nonnegative(),
  errorRate5xxPercent: z.number().min(0).max(100),
  p95LatencyMs: z.number().nonnegative(),
  healthyTrafficActive: z.boolean().default(false),
  saturation: TargetSaturationSchema.optional(),
  poolActive: z.number().int().nonnegative().optional(),
  poolWaiting: z.number().int().nonnegative().optional(),
  poolMax: z.number().int().nonnegative().optional()
});
export type TargetLiveMetrics = z.infer<typeof TargetLiveMetricsSchema>;

export const TargetStatusResponseSchema = z.object({
  status: TargetHealthStatusSchema,
  service: z.string(),
  version: z.string(),
  previousHealthyVersion: z.string(),
  targetRepo: z.string().optional(),
  suspectFilePath: z.string().optional(),
  capabilities: TargetCapabilitiesSchema.default({
    chaosSimulation: false,
    healthyTrafficToggle: false
  }),
  rawEdgeLogPreCollector: z.string().optional(),
  metrics: TargetLiveMetricsSchema.optional()
});
export type TargetStatusResponse = z.infer<typeof TargetStatusResponseSchema>;

export const DecisionPayloadSchema = z.object({
  action: DecisionActionSchema,
  sig: z.string().min(1),
  exp: z.number()
});
export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;

export const SimulateDecisionPayloadSchema = z.object({
  incidentId: z.string().min(1),
  action: DecisionActionSchema
});
export type SimulateDecisionPayload = z.infer<typeof SimulateDecisionPayloadSchema>;

export const ChaosPayloadSchema = z.object({
  mode: IncidentModeSchema.default(IncidentExecutionMode.REPLAY)
});
export type ChaosPayload = z.infer<typeof ChaosPayloadSchema>;

export const IncidentCreatedEventSchema = z.object({
  incidentId: z.string(),
  service: z.string(),
  severity: AlertSeveritySchema,
  mode: IncidentModeSchema,
  at: z.string()
});
export type IncidentCreatedEvent = z.infer<typeof IncidentCreatedEventSchema>;

export const IncidentTransitionEventSchema = z.object({
  incidentId: z.string(),
  from: IncidentStateSchema.nullable(),
  to: IncidentStateSchema,
  at: z.string(),
  reason: z.string().optional()
});
export type IncidentTransitionEvent = z.infer<typeof IncidentTransitionEventSchema>;

export const IncidentRcaEventSchema = IncidentRcaSchema.extend({
  incidentId: z.string()
});
export type IncidentRcaEvent = z.infer<typeof IncidentRcaEventSchema>;

export const IncidentFinopsEventSchema = IncidentFinopsSchema.extend({
  incidentId: z.string()
});
export type IncidentFinopsEvent = z.infer<typeof IncidentFinopsEventSchema>;

export const IncidentDocsEventSchema = z.object({
  incidentId: z.string(),
  sources: z.array(IncidentDocSchema)
});
export type IncidentDocsEvent = z.infer<typeof IncidentDocsEventSchema>;

export const IncidentRemediationEventSchema = IncidentRemediationSchema.extend({
  incidentId: z.string()
});
export type IncidentRemediationEvent = z.infer<typeof IncidentRemediationEventSchema>;

export const IncidentNotifiedEventSchema = z.object({
  incidentId: z.string(),
  emailId: z.string(),
  htmlPreview: z.string().optional(),
  status: NotificationStatusSchema.optional()
});
export type IncidentNotifiedEvent = z.infer<typeof IncidentNotifiedEventSchema>;

export const IncidentDecisionEventSchema = z.object({
  incidentId: z.string(),
  action: DecisionActionSchema,
  source: DecisionSourceSchema
});
export type IncidentDecisionEvent = z.infer<typeof IncidentDecisionEventSchema>;

export const HeartbeatEventSchema = z.object({
  at: z.string()
});
export type HeartbeatEvent = z.infer<typeof HeartbeatEventSchema>;
