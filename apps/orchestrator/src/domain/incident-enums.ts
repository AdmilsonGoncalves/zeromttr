export {
  AlertSeverity,
  DecisionAction,
  DecisionSource,
  IncidentEventType,
  IncidentExecutionMode,
  NotificationStatus,
  ReasoningProvider,
  TargetHealthStatus
} from '@zeromttr/contracts';

export enum GrafanaAlertStatus {
  FIRING = 'firing',
  RESOLVED = 'resolved'
}

export enum GrafanaAnnotationTag {
  REMEDIATION = 'aiops-remediation',
  DECISION = 'aiops-decision',
  DEMO = 'aiops-demo'
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
  UNKNOWN_ALERT = 'unknown-alert',
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
