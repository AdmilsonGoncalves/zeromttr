export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export enum OrchestratorLogEvent {
  ORCHESTRATOR_INITIALIZED = 'orchestrator_initialized',
  INCIDENT_STORE_LOAD_FAILED = 'incident_store_load_failed',
  INCIDENT_STORE_SAVE_FAILED = 'incident_store_save_failed',
  TRACE_ANALYSIS_FAILED = 'trace_analysis_failed',
  GRAFANA_ANNOTATION_FAILED = 'grafana_annotation_failed',
  RESEND_NOTIFICATION_DEGRADED = 'resend_notification_degraded',
  GRAFANA_DECISION_ANNOTATION_FAILED = 'grafana_decision_annotation_failed',
  REPLAY_PLAYBACK_FAILED = 'replay_playback_failed',
  LLM_SYNTHESIS_FAILED = 'llm_synthesis_failed',
  LLM_PATCH_REJECTED = 'llm_patch_rejected',
  PII_PROMPT_GUARD_BLOCKED = 'pii_prompt_guard_blocked'
}
