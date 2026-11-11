export type IncidentState =
  | 'RECEIVED'
  | 'INVESTIGATING'
  | 'ENRICHING'
  | 'REMEDIATING'
  | 'AWAITING_PR'
  | 'NOTIFIED'
  | 'RESOLVED'
  | 'REJECTED'
  | 'FAILED';

export type IncidentDecisionAction = 'approve' | 'reject';
export type IncidentDecisionSource = 'email_hmac' | 'demo_simulation';
export type IncidentMode = 'live' | 'replay';
export type ReasoningSource = 'llm' | 'fallback';
export type TargetHealthStatus = 'healthy' | 'degraded';

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
}

export interface PiiGuardAudit {
  leakedPatternsDetected: number;
  detectedTypes?: string[];
  edgeRedactedTokensVerified: number;
  passed: boolean;
}

export interface Incident {
  id: string;
  service: string;
  severity: string;
  state: IncidentState;
  mode?: IncidentMode;
  startedAt: string;
}

export interface IncidentTransition {
  from: IncidentState | null;
  to: IncidentState;
  at: string;
  reason?: string;
}

export interface IncidentRca {
  summary: string;
  reasoningSource: ReasoningSource;
  evidenceCoveragePercent: number;
  signalsCollected: number;
  signalsTotal: number;
  evidenceBreakdown?: {
    promql: number;
    exemplar: number;
    tempoSpan: number;
    lokiAndDiff: number;
  };
  blastRadius: string[];
  diagnosisSeconds: number;
  traceId: string;
  criticalSpan: string;
  spans: SpanNode[];
  rawEdgeLogPreCollector?: string;
  logSample: string;
  piiGuardAudit: PiiGuardAudit;
  deployVersion?: string;
  mitigations: string[];
  grafanaAnnotationId?: number;
}

export interface IncidentFinops {
  rawBytesFetched: number;
  compactedBytesSent: number;
  payloadReductionPercent: number;
  estimatedTokensSaved: number;
}

export interface IncidentDoc {
  url: string;
  title: string;
  markdownExcerpt: string;
}

export interface IncidentRemediation {
  branchUrl: string;
  pullRequestUrl?: string;
  commitSha?: string;
}

export interface IncidentNotification {
  emailId: string;
  htmlPreview?: string;
}

export interface IncidentDetail extends Incident {
  transitions: IncidentTransition[];
  rca?: IncidentRca;
  finops?: IncidentFinops;
  docs?: IncidentDoc[];
  remediation?: IncidentRemediation;
  notification?: IncidentNotification;
  decision?: IncidentDecisionAction;
  decisionSource?: IncidentDecisionSource;
}

export interface TargetStatusResponse {
  status: TargetHealthStatus;
  service: string;
  version: string;
  previousHealthyVersion: string;
  rawEdgeLogPreCollector?: string;
}

export interface DecisionPayload {
  action: IncidentDecisionAction;
  sig: string;
  exp: number;
}

export interface SimulateDecisionPayload {
  incidentId: string;
  action: IncidentDecisionAction;
}

export interface ChaosPayload {
  mode: IncidentMode;
}

export interface IncidentCreatedEvent {
  incidentId: string;
  service: string;
  severity: string;
  mode: IncidentMode;
  at: string;
}

export interface IncidentTransitionEvent {
  incidentId: string;
  from: IncidentState | null;
  to: IncidentState;
  at: string;
  reason?: string;
}

export interface IncidentRcaEvent extends IncidentRca {
  incidentId: string;
}

export interface IncidentFinopsEvent extends IncidentFinops {
  incidentId: string;
}

export interface IncidentDocsEvent {
  incidentId: string;
  sources: IncidentDoc[];
}

export interface IncidentRemediationEvent extends IncidentRemediation {
  incidentId: string;
}

export interface IncidentNotifiedEvent {
  incidentId: string;
  emailId: string;
  htmlPreview?: string;
}

export interface IncidentDecisionEvent {
  incidentId: string;
  action: IncidentDecisionAction;
  source: IncidentDecisionSource;
}

export interface HeartbeatEvent {
  at: string;
}
