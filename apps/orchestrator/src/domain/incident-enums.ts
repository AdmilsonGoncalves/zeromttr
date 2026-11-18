export enum IncidentEventType {
  CREATED = 'incident.created',
  TRANSITION = 'incident.transition',
  FINOPS = 'incident.finops',
  DOCS = 'incident.docs',
  RCA = 'incident.rca',
  REMEDIATION = 'incident.remediation',
  NOTIFIED = 'incident.notified',
  DECISION = 'incident.decision'
}

export enum TargetHealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNREACHABLE = 'unreachable'
}

export enum NotificationStatus {
  DISPATCHED = 'dispatched',
  DEGRADED = 'degraded'
}

export enum DecisionAction {
  APPROVE = 'approve',
  REJECT = 'reject'
}

export enum DecisionSource {
  EMAIL_HMAC = 'email_hmac',
  DEMO_SIMULATION = 'demo_simulation'
}

export enum IncidentExecutionMode {
  LIVE = 'live',
  REPLAY = 'replay'
}

export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning'
}

export enum TransitionReason {
  INVESTIGATING_TELEMETRY = 'Starting autonomous telemetry investigation',
  ENRICHING_GIT_DIFF = 'Inspecting git deploy diff on GitHub',
  ENRICHING_BEFORE_REMEDIATION = 'Enriching incident state before remediation',
  REMEDIATING_SYNTHESIS = 'Synthesizing RCA and preparing remediation patch',
  AWAITING_PR = 'Opening remediation Pull Request on GitHub',
  NOTIFIED_ON_CALL = 'On-call notification dispatched via Resend',
  DECISION_TTL_EXPIRED = 'Incident decision TTL expired without action',
  STALE_PROCESSING_TIMEOUT = 'Stale incident processing timed out',
  PIPELINE_FAILED = 'Pipeline execution failed'
}

export enum OrchestratorDefault {
  UNKNOWN = 'unknown',
  UNKNOWN_SERVICE = 'unknown-service',
  UNKNOWN_TRACE_ID = 'trace-unknown',
  CRITICAL_ERROR_SPAN = 'critical.error.span',
  DEFAULT_METRIC = 'http_server_duration_milliseconds_bucket',
  DEFAULT_ALERT_NAME = 'ServiceLatencyAnomaly',
  SPAN_ERROR_FALLBACK = 'Span error detected during trace analysis.',
  MITIGATION_FALLBACK = 'Critical degradation mitigated',
  PR_TITLE_FALLBACK = 'remediate incident',
  DEFAULT_BASE_REF = 'HEAD~1',
  DEFAULT_HEAD_REF = 'HEAD'
}
