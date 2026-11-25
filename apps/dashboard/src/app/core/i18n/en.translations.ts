import type { TranslationDictionary } from './i18n.types.js';

export const EN_TRANSLATIONS: TranslationDictionary = {
  // === App, Header & Mode Controls ===
  appTitle: 'ZeroMTTR — War Room Mission Control',
  appSubtitle: 'Autonomous Incident Remediation & Human-in-the-Loop Governance',
  headerMenuBtn: 'Menu',
  headerMenuAriaLabel: 'Toggle command menu',
  liveMode: '⚡ Live API Mode',
  replayMode: '🎬 Replay Mode (Recorded)',
  replayNotice:
    'Notice: Public Replay Mode active reproducing a recorded real run to preserve API quotas.',
  liveKeyPlaceholder: 'X-Live-Demo-Key token...',
  simulateIncident: '💥 Simulate Incident',
  restoreService: '🔄 Restore Service',
  serviceStatusLabel: 'Target Service',
  healthy: 'Healthy',
  degraded: 'Degraded',

  // === KPIs & FinOps Summary ===
  kpiTtdLabel: 'TTD (Diagnosis)',
  kpiTtprLabel: 'TTPR (PR Ready)',
  kpiTtdTarget: 'Target: ≤ 15s (Manual: ~15min)',
  kpiTtprTarget: 'Target: ≤ 30s (Manual: ~30min)',
  finopsPayloadReduction: '💰 Payload Reduction',
  finopsTokensSaved: 'Tokens saved',
  finopsBytesFetched: 'Raw Bytes Fetched',
  finopsBytesSent: 'Compacted Bytes Sent',

  // === Pipeline & Remediation Steps ===
  pipelineTitle: 'Live Remediation Pipeline',
  step1Title: 'Grafana Webhook Received',
  step1Desc: 'Latency p99 anomaly and 5xx error rate webhook received from LGTM stack.',
  step2Title: 'PromQL & Exemplar Trace ID Collected',
  step2Desc: 'Time series analyzed with FinOps reduction (+25%) and exemplar extracted (+25%).',
  step3Title: 'Critical Span Isolated in Tempo',
  step3Desc: 'Tempo isolated pg.pool.acquire error span taking 4.71s (+25%).',
  step4Title: 'Masked Log Extracted from Loki',
  step4Desc: 'Correlated error log extracted with PII masked at edge via OTTL.',
  step5Title: 'Deploy Diff Inspected on GitHub',
  step5Desc:
    'Diff v2.14.7...v2.14.8 correlated with pool acquire changes in repository (+25% ⇒ 4/4 Signals).',
  step6Title: 'Prompt Validated by PiiPromptGuard',
  step6Desc: 'Fail-closed audit for CPF, CNPJ, PIX, and JWT: 0 residual leaked patterns.',
  step7Title: 'RCA/Patch Synthesis & GitHub PR Opened',
  step7Desc: 'Gemini LLM synthesized surgical root cause and opened hotfix/zeromttr-* branch.',
  step8Title: 'Post-Mortem Dispatched via Resend',
  step8Desc:
    'Executive report delivered to on-call engineer with HMAC #fragment link for approval.',

  // === FSM Flow & Hints ===
  fsmFlowLabel: 'FSM Flow',
  fsmAwaitingAlertLabel: '0. LGTM Collect',
  fsmAwaitingAlertTip:
    'Degraded service emitting telemetry — waiting for Prometheus/Grafana to fire the alert.',
  fsmReceivedLabel: '1. Received',
  fsmReceivedTip: 'Grafana webhook alert received and incident initialized.',
  fsmInvestigatingLabel: '2. Investigating',
  fsmInvestigatingTip:
    'Autonomous collection of PromQL metrics, Tempo traces, and redacted Loki logs via MCP.',
  fsmEnrichingLabel: '3. Enriching',
  fsmEnrichingTip: 'Git diff v2.14.7...v2.14.8 inspection and evidence coverage scoring.',
  fsmRemediatingLabel: '4. Remediating',
  fsmRemediatingTip: 'Fail-closed PiiPromptGuard audit and RCA/patch synthesis via LLM.',
  fsmAwaitingPrLabel: '5. Opening PR',
  fsmAwaitingPrTip:
    'Creating hotfix/* branch and opening the Pull Request against the release branch.',
  fsmNotifiedLabel: '6. Notified',
  fsmNotifiedTip: 'Post-mortem dispatched via Resend with #fragment-only HMAC decision link.',
  fsmResolvedLabel: '7. Resolved',
  fsmResolvedTip: 'Human decision recorded and incident closed successfully.',
  fsmRejectedLabel: '7. Rejected',
  fsmRejectedTip: 'Hotfix rejected by on-call engineer.',
  fsmFailedLabel: 'Failed',
  fsmHintIdle: 'Ready — choose a mode above and click "Simulate Incident" to start.',
  fsmHintAwaitingAlert:
    'Service degraded — generating PIX traffic and waiting for Prometheus/Grafana alert ({N}s)...',
  fsmHintActive: 'Autonomous pipeline running — streaming live FSM state transitions.',
  fsmHintNotified: 'Awaiting human decision via email HMAC link (or demo simulation button).',
  fsmHintResolved: 'Incident resolved and approved. Use "Restore Service" to reset the target.',
  fsmHintRejected: 'Hotfix rejected by on-call engineer. Pull Request remains unmerged.',
  fsmHintFailed: 'Pipeline stopped due to failure — check orchestrator logs.',

  // === Evidence Tabs, PII Guard & Git/PR ===
  tabTraceTree: 'Trace Tree & Evidence',
  tabLokiLogs: 'Loki Logs & PII Masking',
  tabGitDiff: 'Git Deploy Diff & FinOps',
  tabLiveMetrics: 'Live Metrics',
  evidenceCoverageLabel: 'Evidence Coverage',
  reasoningSourceLabel: 'Reasoning Source',
  reasoningSourceLlm: 'Gemini LLM',
  reasoningSourceFallback: 'Deterministic Fallback',
  blastRadiusLabel: 'Blast Radius (Affected Services)',
  preCollectorLogLabel: '🔴 Application Log (Pre-Collector with Raw PII)',
  postOttlLogLabel: '🟢 Loki / MCP Agent Log (Post-OTTL transform Masked)',
  piiGuardVerifiedBadge: 'PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)',
  piiGuardBlockedBadge:
    'Fail-Closed Triggered ({N} Leaked Patterns Blocked — Routed to Local Fallback)',
  piiLogWithheldMessage: '[WITHHELD DUE TO PII VIOLATION: {TYPES}]',
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  gitDiffIdleBody:
    'No regression diff under inspection — target service is healthy. Trigger a simulation to inspect the v2.14.7...v2.14.8 diff and FinOps reduction.',
  githubPrTitle: 'Pull Request Opened on GitHub',
  githubPrViewBtn: 'View PR on GitHub ↗',
  githubPrIdleStatus: 'None',
  githubPrOpenStatus: 'Open',
  githubPrApprovedStatus: 'Approved',
  githubPrRejectedStatus: 'Rejected',
  githubPrClosedStatus: 'Closed',
  githubPrIdleBody: 'No active Pull Request — awaiting remediation stage.',
  traceTreeIdleBody: 'No active trace — trigger a simulation to inspect the Tempo span hierarchy.',
  traceTreeAwaitingBody: 'Collecting distributed spans from Tempo...',
  awaitingAuditBadge: 'Awaiting audit...',
  piiIdleBadge: 'No active incident — awaiting simulation',
  piiIdlePreCollectorLog: 'No active failure event in the edge collector.',
  piiIdlePostOttlLog:
    'No masked log collected from Loki. Trigger a simulation to inspect OTTL redaction.',

  // === Resend Post-Mortem & Human Decision / HMAC ===
  resendPreviewTitle: 'Resend Post-Mortem (Sanitized Preview)',
  resendIdleBody:
    'No active incident right now. Trigger a simulation to preview the sanitized Post-Mortem sent via Resend.',
  resendDefaultBody: 'Awaiting on-call approval via exclusive signed link.',
  resendDispatchedBadge: 'Post-Mortem email dispatched to on-call engineer via Resend',
  resendDispatchedBody:
    'HMAC-signed decision link delivered exclusively inside the email URL #fragment.',
  resendDegradedTitle: '⚠️ Resend Delivery in Degraded Mode',
  resendDegradedBody:
    'The Resend API rejected the configured sender domain (HTTP 403/delivery error). The incident remains active for simulated decision in the dashboard.',
  awaitingDecisionBadge: 'Awaiting on-call decision via HMAC link dispatched by email',
  simulateDecisionBtn: '[Simulation Mode] Simulate On-Call Approval',
  decisionPageTitle: 'Remediation Decision Confirmation',
  decisionApproveBtn: 'Approve Hotfix (Resolve Incident)',
  decisionRejectBtn: 'Reject Hotfix',
  decisionSuccessMsg: 'Decision successfully registered via signed HMAC!',
  decisionErrorMsg: 'Failed to validate HMAC signature or link has expired.',
  decisionAlreadyResolvedError:
    'This incident has already been closed (status RESOLVED or REJECTED).',
  decisionAlreadyClosedBanner:
    'This incident has already been processed and is closed. Further actions are disabled.',
  decisionConfirmationHelp:
    'For security and RFC 7231 compliance, explicit confirmation on this page is required to prevent email scanner bots from triggering hotfixes automatically.',
  decisionTokenSecurityNote:
    'Security Note: The decision token travels strictly inside the URL hash (#fragment) and is never exposed to HTTP logs or proxy servers.',
  backToWarRoom: 'Back to War Room Dashboard',
  hmacMissingFragmentError: 'Missing HMAC fragment in URL (#action=...&sig=...&exp=...)',
  hmacInvalidActionError: 'Invalid action parameter in hash (expected approve or reject)',
  hmacMissingSigError: 'Missing HMAC sig signature in hash',
  hmacInvalidExpError: 'Invalid exp timestamp in hash',
  hmacExpiredError: 'HMAC decision link has expired',

  // === Target Telemetry & Healthy Traffic ===
  healthyTrafficStartBtn: '▶ Healthy Traffic',
  healthyTrafficStopBtn: '⏹ Stop Traffic',
  healthyTrafficActiveBadge: 'Traffic Active',
  healthyTrafficIdleBadge: 'Idle',
  targetTelemetryLabel: 'Target Telemetry',
  targetRpsLabel: 'Req/s',
  targetError5xxLabel: '5xx Error',
  targetP95Label: 'p95 Latency',
  targetPoolLabel: 'DB Pool',
  targetPoolActiveLabel: 'Active',
  targetPoolWaitingLabel: 'Waiting',
  targetSloLatencyHint: 'SLO: ≤ 500ms',
  targetSlaErrorOk: 'Healthy SLA',
  targetSlaErrorBreach: '5xx Errors Active',
  tooltipHealthyTraffic:
    'Starts or stops continuous healthy traffic on api-pagamentos-core to demonstrate Before → During → After.',
  tooltipHealthyTrafficRequiresRestore:
    'Target service is degraded (v2.14.8). Click "Restore Service" before starting healthy traffic.',

  // === Charts ===
  chartLatencyErrorTitle: 'p95 Latency (ms) & 5xx Error Rate (%)',
  chartThroughputPoolTitle: 'Throughput (req/s) & DB Pool Usage',
  chartPoolGaugeLabel: 'Pool Saturation',
  chartFinopsGaugeLabel: 'FinOps Reduction',
  chartFinopsBarsTitle: 'LLM Payload (Raw vs Compacted)',
  chartMttrBarsTitle: 'Autonomous vs Manual MTTR (~30m)',
  chartAwaitingSamples: 'Awaiting live target service samples (2s polling)...',
  chartSloThreshold: 'SLO 500ms',

  // === Turnstile & Tooltips ===
  turnstilePendingNotice:
    'Complete the Cloudflare Turnstile verification challenge to enable simulation controls.',
  turnstileVerifiedBadge: 'Human verified',
  turnstileLoadFailedNotice: 'Failed to load Cloudflare Turnstile verification.',
  turnstileRetryBtn: 'Retry',
  tooltipTurnstilePending: 'Awaiting Cloudflare Turnstile challenge completion.',
  tooltipModeSelector:
    'Switch between Live Mode (real Gemini, GitHub, and Resend) and Replay Mode (recorded run).',
  tooltipLiveKeyInput: 'Enter the server LIVE_DEMO_KEY to authorize actions in Live API Mode.',
  tooltipSimulateIncident:
    'Starts the incident: degrades the target service (v2.14.8) in Live Mode or plays the recorded run in Replay Mode.',
  tooltipRestoreService: 'Clears pool saturation chaos and restores the target service to healthy.',
  tooltipLanguageSelector: 'Switch UI language between Portuguese, English, and Spanish.',
  tooltipViewPr: 'Open the autonomously generated hotfix Pull Request on GitHub.',
  tooltipSimulateDecision:
    'Simulates on-call approval in demo mode (production requires the email HMAC link).',

  // === Toasts & Notifications ===
  toastLiveKeyRequiredSummary: 'Live key invalid or not provided',
  toastLiveKeyRequiredDetail:
    'Provide a valid X-Live-Demo-Key to trigger actions in Live API Mode.',
  toastCooldownSummary: 'Cooldown active',
  toastCooldownDetail: 'Please wait for the cooldown window before triggering another incident.',
  toastCooldownDetailWithSeconds:
    'Chaos simulation is in cooldown. Please wait {N} seconds before triggering again.',
  toastRateLimitSummary: 'Rate limit exceeded',
  toastRateLimitDetail: 'Too many requests from this IP. Please wait a moment before trying again.',
  toastRateLimitDetailWithSeconds:
    'Too many requests from this IP. Please wait {N} seconds before trying again.',
  toastTurnstileRequiredSummary: 'Human verification required',
  toastTurnstileRequiredDetail:
    'Please complete the Cloudflare Turnstile challenge again before running this action.',
  toastActionErrorSummary: 'Demo action failed',
  toastActionErrorDetail: 'Could not complete the operation on the orchestrator.',
  toastChaosStartedSummary: 'Incident triggered',
  toastChaosStartedDetail: 'Simulation started — follow live telemetry in the War Room.',
  toastServiceRestoredSummary: 'Service restored',
  toastServiceRestoredDetail: 'Chaos state cleared and target service returned to healthy.',
  toastDecisionApprovedSummary: 'Hotfix approved',
  toastDecisionApprovedDetail:
    'Incident resolved and target service restored! Incident data remains on screen for inspection.',
  toastHealthyTrafficStartedSummary: 'Healthy traffic started',
  toastHealthyTrafficStartedDetail: 'Continuous PIX requests streaming to api-pagamentos-core.',
  toastHealthyTrafficStoppedSummary: 'Healthy traffic stopped',
  toastHealthyTrafficStoppedDetail: 'Continuous request stream stopped.'
};
