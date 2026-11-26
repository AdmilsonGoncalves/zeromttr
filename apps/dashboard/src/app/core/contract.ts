export {
  AlertSeverity,
  DecisionAction,
  DecisionSource,
  IncidentEventType,
  IncidentExecutionMode,
  IncidentState,
  NotificationStatus,
  ReasoningProvider,
  SettingsPersistenceEngine,
  SystemLogLevel,
  TargetHealthStatus
} from '@zeromttr/contracts';

export type {
  ChaosPayload,
  DecisionPayload,
  HeartbeatEvent,
  IncidentCreatedEvent,
  IncidentDecisionAction,
  IncidentDecisionEvent,
  IncidentDecisionSource,
  IncidentDetail,
  IncidentDoc,
  IncidentDocsEvent,
  IncidentFinops,
  IncidentFinopsEvent,
  IncidentMode,
  IncidentNotification,
  IncidentNotifiedEvent,
  IncidentRca,
  IncidentRcaEvent,
  IncidentRemediation,
  IncidentRemediationEvent,
  IncidentSummary as Incident,
  IncidentTransition,
  IncidentTransitionEvent,
  PiiGuardAudit,
  ReasoningSource,
  SettingsAuditEntry,
  SimulateDecisionPayload,
  SpanNode,
  SystemSettings,
  SystemSettingsPatch,
  SystemSettingsReadonlyInfo,
  SystemSettingsResponse,
  TargetCapabilities,
  TargetLiveMetrics,
  TargetSaturation,
  TargetStatusResponse
} from '@zeromttr/contracts';

export interface DemoConfigResponse {
  demoModeEnabled?: boolean;
  requireDemoKey?: boolean;
  publicLiveDemo: boolean;
  turnstileSiteKey: string | null;
  turnstileRequired: boolean;
}
