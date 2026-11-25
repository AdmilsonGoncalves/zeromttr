export enum Language {
  PT_BR = 'pt-BR',
  EN_US = 'en-US',
  ES_ES = 'es-ES'
}

/**
 * Strongly-typed translation dictionary grouped by dashboard domain.
 */
export interface TranslationDictionary {
  // === App, Header & Mode Controls ===
  appTitle: string;
  appSubtitle: string;
  headerMenuBtn: string;
  headerMenuAriaLabel: string;
  liveMode: string;
  replayMode: string;
  replayNotice: string;
  liveKeyPlaceholder: string;
  simulateIncident: string;
  restoreService: string;
  serviceStatusLabel: string;
  healthy: string;
  degraded: string;

  // === KPIs & FinOps Summary ===
  kpiTtdLabel: string;
  kpiTtprLabel: string;
  kpiTtdTarget: string;
  kpiTtprTarget: string;
  finopsPayloadReduction: string;
  finopsTokensSaved: string;
  finopsBytesFetched: string;
  finopsBytesSent: string;

  // === Pipeline & Remediation Steps ===
  pipelineTitle: string;
  step1Title: string;
  step1Desc: string;
  step2Title: string;
  step2Desc: string;
  step3Title: string;
  step3Desc: string;
  step4Title: string;
  step4Desc: string;
  step5Title: string;
  step5Desc: string;
  step6Title: string;
  step6Desc: string;
  step7Title: string;
  step7Desc: string;
  step8Title: string;
  step8Desc: string;

  // === FSM Flow & Hints ===
  fsmFlowLabel: string;
  fsmAwaitingAlertLabel: string;
  fsmAwaitingAlertTip: string;
  fsmReceivedLabel: string;
  fsmReceivedTip: string;
  fsmInvestigatingLabel: string;
  fsmInvestigatingTip: string;
  fsmEnrichingLabel: string;
  fsmEnrichingTip: string;
  fsmRemediatingLabel: string;
  fsmRemediatingTip: string;
  fsmAwaitingPrLabel: string;
  fsmAwaitingPrTip: string;
  fsmNotifiedLabel: string;
  fsmNotifiedTip: string;
  fsmResolvedLabel: string;
  fsmResolvedTip: string;
  fsmRejectedLabel: string;
  fsmRejectedTip: string;
  fsmFailedLabel: string;
  fsmHintIdle: string;
  fsmHintAwaitingAlert: string;
  fsmHintActive: string;
  fsmHintNotified: string;
  fsmHintResolved: string;
  fsmHintRejected: string;
  fsmHintFailed: string;

  // === Evidence Tabs, PII Guard & Git/PR ===
  tabTraceTree: string;
  tabLokiLogs: string;
  tabGitDiff: string;
  tabLiveMetrics: string;
  evidenceCoverageLabel: string;
  reasoningSourceLabel: string;
  reasoningSourceLlm: string;
  reasoningSourceFallback: string;
  blastRadiusLabel: string;
  preCollectorLogLabel: string;
  postOttlLogLabel: string;
  piiGuardVerifiedBadge: string;
  piiGuardBlockedBadge: string;
  piiLogWithheldMessage: string;
  gitDiffTitle: string;
  githubPrTitle: string;
  githubPrViewBtn: string;
  awaitingAuditBadge: string;

  // === Resend Post-Mortem & Human Decision / HMAC ===
  resendPreviewTitle: string;
  resendIdleBody: string;
  resendDefaultBody: string;
  resendDispatchedBadge: string;
  resendDispatchedBody: string;
  resendDegradedTitle: string;
  resendDegradedBody: string;
  awaitingDecisionBadge: string;
  simulateDecisionBtn: string;
  decisionPageTitle: string;
  decisionApproveBtn: string;
  decisionRejectBtn: string;
  decisionSuccessMsg: string;
  decisionErrorMsg: string;
  decisionAlreadyResolvedError: string;
  decisionAlreadyClosedBanner: string;
  decisionConfirmationHelp: string;
  decisionTokenSecurityNote: string;
  backToWarRoom: string;
  hmacMissingFragmentError: string;
  hmacInvalidActionError: string;
  hmacMissingSigError: string;
  hmacInvalidExpError: string;
  hmacExpiredError: string;

  // === Target Telemetry & Healthy Traffic ===
  healthyTrafficStartBtn: string;
  healthyTrafficStopBtn: string;
  healthyTrafficActiveBadge: string;
  healthyTrafficIdleBadge: string;
  targetTelemetryLabel: string;
  targetRpsLabel: string;
  targetError5xxLabel: string;
  targetP95Label: string;
  targetPoolLabel: string;
  targetPoolActiveLabel: string;
  targetPoolWaitingLabel: string;
  targetSloLatencyHint: string;
  targetSlaErrorOk: string;
  targetSlaErrorBreach: string;
  tooltipHealthyTraffic: string;
  tooltipHealthyTrafficRequiresRestore: string;

  // === Charts ===
  chartLatencyErrorTitle: string;
  chartThroughputPoolTitle: string;
  chartPoolGaugeLabel: string;
  chartFinopsGaugeLabel: string;
  chartFinopsBarsTitle: string;
  chartMttrBarsTitle: string;
  chartAwaitingSamples: string;
  chartSloThreshold: string;

  // === Turnstile & Tooltips ===
  turnstilePendingNotice: string;
  turnstileVerifiedBadge: string;
  turnstileLoadFailedNotice: string;
  turnstileRetryBtn: string;
  tooltipTurnstilePending: string;
  tooltipModeSelector: string;
  tooltipLiveKeyInput: string;
  tooltipSimulateIncident: string;
  tooltipRestoreService: string;
  tooltipLanguageSelector: string;
  tooltipViewPr: string;
  tooltipSimulateDecision: string;

  // === Toasts & Notifications ===
  toastLiveKeyRequiredSummary: string;
  toastLiveKeyRequiredDetail: string;
  toastCooldownSummary: string;
  toastCooldownDetail: string;
  toastCooldownDetailWithSeconds: string;
  toastRateLimitSummary: string;
  toastRateLimitDetail: string;
  toastRateLimitDetailWithSeconds: string;
  toastTurnstileRequiredSummary: string;
  toastTurnstileRequiredDetail: string;
  toastActionErrorSummary: string;
  toastActionErrorDetail: string;
  toastChaosStartedSummary: string;
  toastChaosStartedDetail: string;
  toastServiceRestoredSummary: string;
  toastServiceRestoredDetail: string;
  toastDecisionApprovedSummary: string;
  toastDecisionApprovedDetail: string;
  toastHealthyTrafficStartedSummary: string;
  toastHealthyTrafficStartedDetail: string;
  toastHealthyTrafficStoppedSummary: string;
  toastHealthyTrafficStoppedDetail: string;
}
