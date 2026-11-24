import { Injectable, computed, signal } from '@angular/core';

export type Language = 'pt' | 'en';

export interface TranslationDictionary {
  appTitle: string;
  appSubtitle: string;
  liveMode: string;
  replayMode: string;
  replayNotice: string;
  liveKeyPlaceholder: string;
  simulateIncident: string;
  restoreService: string;
  serviceStatusLabel: string;
  healthy: string;
  degraded: string;
  finopsPayloadReduction: string;
  finopsTokensSaved: string;
  kpiTtdLabel: string;
  kpiTtprLabel: string;
  kpiTtdTarget: string;
  kpiTtprTarget: string;
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
  finopsBytesFetched: string;
  finopsBytesSent: string;
  githubPrTitle: string;
  githubPrViewBtn: string;
  resendPreviewTitle: string;
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
  awaitingAuditBadge: string;
  resendDefaultBody: string;
  hmacMissingFragmentError: string;
  hmacInvalidActionError: string;
  hmacMissingSigError: string;
  hmacInvalidExpError: string;
  hmacExpiredError: string;
  toastLiveKeyRequiredSummary: string;
  toastLiveKeyRequiredDetail: string;
  turnstilePendingNotice: string;
  turnstileVerifiedBadge: string;
  tooltipTurnstilePending: string;
  toastCooldownSummary: string;
  toastCooldownDetail: string;
  toastCooldownDetailWithSeconds: string;
  toastRateLimitSummary: string;
  toastRateLimitDetail: string;
  toastRateLimitDetailWithSeconds: string;
  toastTurnstileRequiredSummary: string;
  toastTurnstileRequiredDetail: string;
  turnstileLoadFailedNotice: string;
  turnstileRetryBtn: string;
  toastActionErrorSummary: string;
  toastActionErrorDetail: string;
  toastChaosStartedSummary: string;
  toastChaosStartedDetail: string;
  toastServiceRestoredSummary: string;
  toastServiceRestoredDetail: string;
  toastDecisionApprovedSummary: string;
  toastDecisionApprovedDetail: string;
  tooltipModeSelector: string;
  tooltipLiveKeyInput: string;
  tooltipSimulateIncident: string;
  tooltipRestoreService: string;
  tooltipLanguageSelector: string;
  tooltipViewPr: string;
  tooltipSimulateDecision: string;
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
  resendDispatchedBadge: string;
  resendDispatchedBody: string;
  resendDegradedTitle: string;
  resendDegradedBody: string;
  healthyTrafficStartBtn: string;
  healthyTrafficStopBtn: string;
  tooltipHealthyTraffic: string;
  tooltipHealthyTrafficRequiresRestore: string;
  targetTelemetryLabel: string;
  targetRpsLabel: string;
  targetError5xxLabel: string;
  targetP95Label: string;
  targetPoolLabel: string;
  healthyTrafficActiveBadge: string;
  healthyTrafficIdleBadge: string;
  toastHealthyTrafficStartedSummary: string;
  toastHealthyTrafficStartedDetail: string;
  toastHealthyTrafficStoppedSummary: string;
  toastHealthyTrafficStoppedDetail: string;
  targetPoolActiveLabel: string;
  targetPoolWaitingLabel: string;
  targetSloLatencyHint: string;
  targetSlaErrorOk: string;
  targetSlaErrorBreach: string;
  chartLatencyErrorTitle: string;
  chartThroughputPoolTitle: string;
  chartPoolGaugeLabel: string;
  chartFinopsGaugeLabel: string;
  chartFinopsBarsTitle: string;
  chartMttrBarsTitle: string;
  chartAwaitingSamples: string;
  chartSloThreshold: string;
  headerMenuBtn: string;
  headerMenuAriaLabel: string;
}

const PT_TRANSLATIONS: TranslationDictionary = {
  appTitle: 'ZeroMTTR — War Room Mission Control',
  appSubtitle: 'Remediação Autônoma de Incidentes & Governança com Humano no Circuito',
  liveMode: '⚡ Live API Mode',
  replayMode: '🎬 Replay Mode (Gravado)',
  replayNotice:
    'Aviso: Modo Replay público ativo reproduzindo execução real gravada para preservar cotas de API.',
  liveKeyPlaceholder: 'Chave X-Live-Demo-Key...',
  simulateIncident: '💥 Simular Incidente',
  restoreService: '🔄 Restaurar Serviço',
  serviceStatusLabel: 'Serviço Alvo',
  healthy: 'Saudável',
  degraded: 'Degradado',
  finopsPayloadReduction: '💰 Payload Reduction',
  finopsTokensSaved: 'Tokens poupados',
  kpiTtdLabel: 'TTD (Diagnóstico)',
  kpiTtprLabel: 'TTPR (PR Pronto)',
  kpiTtdTarget: 'Meta: ≤ 15s (Manual: ~15min)',
  kpiTtprTarget: 'Meta: ≤ 30s (Manual: ~30min)',
  pipelineTitle: 'Pipeline de Remediação ao Vivo',
  step1Title: 'Webhook Grafana Recebido',
  step1Desc: 'Alerta de latência p99 e taxa de erro 5xx recebido da stack LGTM.',
  step2Title: 'PromQL & Exemplar Trace ID Coletados',
  step2Desc: 'Série temporal analisada com redução FinOps (+25%) e exemplar extraído (+25%).',
  step3Title: 'Span Crítico Isolado no Tempo',
  step3Desc: 'Tempo isolou o span com erro pg.pool.acquire de 4.71s (+25%).',
  step4Title: 'Log Mascarado Extraído do Loki',
  step4Desc: 'Log de erro filtrado por trace_id com PII mascarada na borda via OTTL.',
  step5Title: 'Deploy Diff Inspecionado no GitHub',
  step5Desc:
    'Diff v2.14.7...v2.14.8 correlacionado à alteração de pool no repositório (+25% ⇒ 4/4 Sinais).',
  step6Title: 'Prompt Validado pelo PiiPromptGuard',
  step6Desc: 'Auditoria fail-closed de CPF, CNPJ, PIX e JWT: 0 vazamentos residuais.',
  step7Title: 'Síntese RCA/Patch & PR Aberto',
  step7Desc:
    'Gemini LLM sintetizou a causa raiz cirúrgica e branch hotfix/zeromttr-* aberta no GitHub.',
  step8Title: 'Post-Mortem Enviado via Resend',
  step8Desc:
    'Relatório executivo entregue ao plantonista com link HMAC em #fragment para aprovação.',
  tabTraceTree: 'Trace Tree & Evidências',
  tabLokiLogs: 'Logs Loki & Mascaramento PII',
  tabGitDiff: 'Git Deploy Diff & FinOps',
  tabLiveMetrics: 'Telemetria ao Vivo',
  evidenceCoverageLabel: 'Evidence Coverage',
  reasoningSourceLabel: 'Reasoning Source',
  reasoningSourceLlm: 'Gemini LLM',
  reasoningSourceFallback: 'Deterministic Fallback',
  blastRadiusLabel: 'Blast Radius (Serviços Afetados)',
  preCollectorLogLabel: '🔴 Log Reportado na Aplicação (Pré-Collector c/ PII Bruta)',
  postOttlLogLabel: '🟢 Log no Loki / Agente MCP (Pós-OTTL transform Mascarado)',
  piiGuardVerifiedBadge: 'PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)',
  piiGuardBlockedBadge:
    'Fail-Closed Triggered ({N} Leaked Patterns Blocked — Routed to Local Fallback)',
  piiLogWithheldMessage: '[RETIDO POR VIOLAÇÃO PII: {TYPES}]',
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  finopsBytesFetched: 'Bytes Brutos Coletados',
  finopsBytesSent: 'Bytes Compactados Enviados',
  githubPrTitle: 'Pull Request Aberto no GitHub',
  githubPrViewBtn: 'Ver PR no GitHub ↗',
  resendPreviewTitle: 'Post-Mortem Resend (Preview Sanitizado)',
  awaitingDecisionBadge: 'Aguardando decisão via link HMAC enviado por e-mail ao plantonista',
  simulateDecisionBtn: '[Modo Simulação] Simular Aprovação do Plantonista',
  decisionPageTitle: 'Confirmação de Decisão de Remediação',
  decisionApproveBtn: 'Aprovar Hotfix (Resolver Incidente)',
  decisionRejectBtn: 'Rejeitar Hotfix',
  decisionSuccessMsg: 'Decisão registrada com sucesso via HMAC assinado!',
  decisionErrorMsg: 'Falha ao validar assinatura HMAC ou link expirado.',
  decisionAlreadyResolvedError:
    'Este incidente já foi encerrado anteriormente (status RESOLVED ou REJECTED).',
  decisionAlreadyClosedBanner:
    'Este incidente já foi processado e encontra-se encerrado. Novas ações não são permitidas.',
  decisionConfirmationHelp:
    'Por segurança e conformidade com RFC 7231, a confirmação na página é necessária para evitar que rastreadores de e-mail acionem o hotfix automaticamente.',
  decisionTokenSecurityNote:
    'Nota de Segurança: O token de decisão trafega exclusivamente pelo hash da URL (#fragment) e nunca é exposto em logs HTTP ou servidores intermediários.',
  backToWarRoom: 'Voltar ao War Room Dashboard',
  awaitingAuditBadge: 'Aguardando auditoria...',
  resendDefaultBody: 'Aguardando aprovação do plantonista via link seguro exclusivo.',
  hmacMissingFragmentError: 'Fragmento HMAC ausente na URL (#action=...&sig=...&exp=...)',
  hmacInvalidActionError: 'Parâmetro action inválido no hash (esperado approve ou reject)',
  hmacMissingSigError: 'Assinatura sig HMAC ausente no hash',
  hmacInvalidExpError: 'Timestamp exp inválido no hash',
  hmacExpiredError: 'Link de decisão HMAC expirou',
  toastLiveKeyRequiredSummary: 'Chave Live inválida ou não informada',
  toastLiveKeyRequiredDetail:
    'Informe a chave X-Live-Demo-Key válida para executar ações no Modo Live.',
  turnstilePendingNotice:
    'Complete a verificação anti-robô (Cloudflare Turnstile) para habilitar os controles de simulação.',
  turnstileVerifiedBadge: 'Humano verificado',
  tooltipTurnstilePending: 'Aguardando conclusão do desafio Cloudflare Turnstile.',
  toastCooldownSummary: 'Cooldown ativo',
  toastCooldownDetail: 'Aguarde o intervalo de cooldown antes de disparar outro incidente.',
  toastCooldownDetailWithSeconds:
    'Simulação em cooldown. Aguarde {N} segundos antes de disparar novamente.',
  toastRateLimitSummary: 'Limite de requisições atingido',
  toastRateLimitDetail:
    'Muitas requisições deste IP. Aguarde alguns instantes antes de tentar novamente.',
  toastRateLimitDetailWithSeconds:
    'Muitas requisições deste IP. Aguarde {N} segundos antes de tentar novamente.',
  toastTurnstileRequiredSummary: 'Verificação humana necessária',
  toastTurnstileRequiredDetail:
    'Complete novamente o desafio Cloudflare Turnstile antes de executar esta ação.',
  turnstileLoadFailedNotice: 'Falha ao carregar a verificação Cloudflare Turnstile.',
  turnstileRetryBtn: 'Tentar novamente',
  toastActionErrorSummary: 'Falha na ação de demonstração',
  toastActionErrorDetail: 'Não foi possível concluir a operação no orquestrador.',
  toastChaosStartedSummary: 'Incidente disparado',
  toastChaosStartedDetail: 'Simulação iniciada — acompanhe a telemetria ao vivo no War Room.',
  toastServiceRestoredSummary: 'Serviço restaurado',
  toastServiceRestoredDetail: 'O estado de caos foi limpo e o serviço alvo voltou ao normal.',
  toastDecisionApprovedSummary: 'Hotfix aprovado',
  toastDecisionApprovedDetail:
    'Incidente resolvido e serviço alvo restaurado! Os dados permanecem na tela para inspeção.',
  tooltipModeSelector:
    'Alterna entre Modo Live (Gemini, GitHub e Resend reais) e Modo Replay (execução gravada).',
  tooltipLiveKeyInput:
    'Informe a chave LIVE_DEMO_KEY configurada no servidor para liberar o Modo Live.',
  tooltipSimulateIncident:
    'Inicia o incidente: degrada o serviço alvo (v2.14.8) no Modo Live ou executa a gravação no Modo Replay.',
  tooltipRestoreService:
    'Remove a saturação de pool e restaura o serviço alvo para o estado saudável.',
  tooltipLanguageSelector: 'Alterna o idioma da interface entre Português e Inglês.',
  tooltipViewPr: 'Abre o Pull Request de hotfix gerado automaticamente no GitHub.',
  tooltipSimulateDecision:
    'Simula a aprovação do plantonista no ambiente de demonstração (em produção exige link HMAC do e-mail).',
  fsmFlowLabel: 'Fluxo FSM',
  fsmAwaitingAlertLabel: '0. Coleta LGTM',
  fsmAwaitingAlertTip:
    'Serviço degradado emitindo telemetria — aguardando Prometheus/Grafana disparar o alerta.',
  fsmReceivedLabel: '1. Recebido',
  fsmReceivedTip: 'Alerta recebido pelo webhook do Grafana e incidente inicializado.',
  fsmInvestigatingLabel: '2. Investigando',
  fsmInvestigatingTip:
    'Coleta autônoma de PromQL, traces no Tempo e logs mascarados no Loki via MCP.',
  fsmEnrichingLabel: '3. Enriquecendo',
  fsmEnrichingTip: 'Inspeção do git diff v2.14.7...v2.14.8 e validação de cobertura de sinais.',
  fsmRemediatingLabel: '4. Remediando',
  fsmRemediatingTip: 'Auditoria fail-closed do PiiPromptGuard e síntese do RCA/patch via LLM.',
  fsmAwaitingPrLabel: '5. Abrindo PR',
  fsmAwaitingPrTip:
    'Criação da branch hotfix/* e abertura do Pull Request contra a branch de release.',
  fsmNotifiedLabel: '6. Notificado',
  fsmNotifiedTip: 'Post-mortem enviado via Resend com link HMAC exclusivo no #fragment.',
  fsmResolvedLabel: '7. Resolvido',
  fsmResolvedTip: 'Decisão humana registrada e incidente encerrado com sucesso.',
  fsmRejectedLabel: '7. Rejeitado',
  fsmRejectedTip: 'Decisão de rejeição registrada pelo operador.',
  fsmFailedLabel: 'Falhou',
  fsmHintIdle: 'Pronto — escolha o modo acima e clique em "Simular Incidente" para iniciar.',
  fsmHintAwaitingAlert:
    'Serviço degradado — gerando tráfego PIX e aguardando Prometheus/Grafana disparar o alerta ({N}s)...',
  fsmHintActive: 'Pipeline autônomo em execução — acompanhando transições da FSM em tempo real.',
  fsmHintNotified: 'Aguardando decisão humana via link HMAC no e-mail (ou simulação no painel).',
  fsmHintResolved: 'Incidente resolvido e aprovado. Use "Restaurar Serviço" para limpar o alvo.',
  fsmHintRejected: 'Hotfix rejeitado pelo plantonista. O PR permanece sem merge.',
  fsmHintFailed: 'Pipeline interrompido por falha — verifique os logs do orquestrador.',
  resendDispatchedBadge: 'E-mail Post-Mortem enviado ao plantonista via Resend',
  resendDispatchedBody:
    'Link de decisão assinado via HMAC entregue exclusivamente no #fragment do e-mail.',
  resendDegradedTitle: '⚠️ Envio Resend em Modo Degradado',
  resendDegradedBody:
    'A API do Resend recusou o domínio remetente configurado (HTTP 403/erro de entrega). O incidente permanece ativo para decisão simulada no painel.',
  healthyTrafficStartBtn: '▶ Tráfego Saudável',
  healthyTrafficStopBtn: '⏹ Parar Tráfego',
  tooltipHealthyTraffic:
    'Inicia ou interrompe fluxo contínuo de requisições saudáveis em api-pagamentos-core para demonstrar Antes → Durante → Depois.',
  tooltipHealthyTrafficRequiresRestore:
    'Serviço alvo degradado (v2.14.8). Use "Restaurar Serviço" antes de iniciar o tráfego saudável.',
  targetTelemetryLabel: 'Telemetria Alvo',
  targetRpsLabel: 'Req/s',
  targetError5xxLabel: 'Erro 5xx',
  targetP95Label: 'Latência p95',
  targetPoolLabel: 'Pool DB',
  healthyTrafficActiveBadge: 'Tráfego Ativo',
  healthyTrafficIdleBadge: 'Ocioso',
  toastHealthyTrafficStartedSummary: 'Tráfego saudável ativado',
  toastHealthyTrafficStartedDetail:
    'Requisições PIX contínuas sendo enviadas para api-pagamentos-core.',
  toastHealthyTrafficStoppedSummary: 'Tráfego saudável interrompido',
  toastHealthyTrafficStoppedDetail: 'Fluxo contínuo de requisições encerrado.',
  targetPoolActiveLabel: 'Ativas',
  targetPoolWaitingLabel: 'Em espera',
  targetSloLatencyHint: 'SLO: ≤ 500ms',
  targetSlaErrorOk: 'SLA Saudável',
  targetSlaErrorBreach: 'Falhas 5xx Ativas',
  chartLatencyErrorTitle: 'Latência p95 (ms) & Taxa de Erro 5xx (%)',
  chartThroughputPoolTitle: 'Throughput (req/s) & Uso do Pool DB',
  chartPoolGaugeLabel: 'Saturação do Pool',
  chartFinopsGaugeLabel: 'Redução FinOps',
  chartFinopsBarsTitle: 'Payload LLM (Bruto vs Compactado)',
  chartMttrBarsTitle: 'MTTR Autônomo vs Manual (~30m)',
  chartAwaitingSamples: 'Aguardando amostras ao vivo do serviço alvo (polling 2s)...',
  chartSloThreshold: 'SLO 500ms',
  headerMenuBtn: 'Menu',
  headerMenuAriaLabel: 'Alternar menu de controles'
};

const EN_TRANSLATIONS: TranslationDictionary = {
  appTitle: 'ZeroMTTR — War Room Mission Control',
  appSubtitle: 'Autonomous Incident Remediation & Human-in-the-Loop Governance',
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
  finopsPayloadReduction: '💰 Payload Reduction',
  finopsTokensSaved: 'Tokens saved',
  kpiTtdLabel: 'TTD (Diagnosis)',
  kpiTtprLabel: 'TTPR (PR Ready)',
  kpiTtdTarget: 'Target: ≤ 15s (Manual: ~15min)',
  kpiTtprTarget: 'Target: ≤ 30s (Manual: ~30min)',
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
  finopsBytesFetched: 'Raw Bytes Fetched',
  finopsBytesSent: 'Compacted Bytes Sent',
  githubPrTitle: 'Pull Request Opened on GitHub',
  githubPrViewBtn: 'View PR on GitHub ↗',
  resendPreviewTitle: 'Resend Post-Mortem (Sanitized Preview)',
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
  awaitingAuditBadge: 'Awaiting audit...',
  resendDefaultBody: 'Awaiting on-call approval via exclusive signed link.',
  hmacMissingFragmentError: 'Missing HMAC fragment in URL (#action=...&sig=...&exp=...)',
  hmacInvalidActionError: 'Invalid action parameter in hash (expected approve or reject)',
  hmacMissingSigError: 'Missing HMAC sig signature in hash',
  hmacInvalidExpError: 'Invalid exp timestamp in hash',
  hmacExpiredError: 'HMAC decision link has expired',
  toastLiveKeyRequiredSummary: 'Live key invalid or not provided',
  toastLiveKeyRequiredDetail:
    'Provide a valid X-Live-Demo-Key to trigger actions in Live API Mode.',
  turnstilePendingNotice:
    'Complete the Cloudflare Turnstile verification challenge to enable simulation controls.',
  turnstileVerifiedBadge: 'Human verified',
  tooltipTurnstilePending: 'Awaiting Cloudflare Turnstile challenge completion.',
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
  turnstileLoadFailedNotice: 'Failed to load Cloudflare Turnstile verification.',
  turnstileRetryBtn: 'Retry',
  toastActionErrorSummary: 'Demo action failed',
  toastActionErrorDetail: 'Could not complete the operation on the orchestrator.',
  toastChaosStartedSummary: 'Incident triggered',
  toastChaosStartedDetail: 'Simulation started — follow live telemetry in the War Room.',
  toastServiceRestoredSummary: 'Service restored',
  toastServiceRestoredDetail: 'Chaos state cleared and target service returned to healthy.',
  toastDecisionApprovedSummary: 'Hotfix approved',
  toastDecisionApprovedDetail:
    'Incident resolved and target service restored! Incident data remains on screen for inspection.',
  tooltipModeSelector:
    'Switch between Live Mode (real Gemini, GitHub, and Resend) and Replay Mode (recorded run).',
  tooltipLiveKeyInput: 'Enter the server LIVE_DEMO_KEY to authorize actions in Live API Mode.',
  tooltipSimulateIncident:
    'Starts the incident: degrades the target service (v2.14.8) in Live Mode or plays the recorded run in Replay Mode.',
  tooltipRestoreService: 'Clears pool saturation chaos and restores the target service to healthy.',
  tooltipLanguageSelector: 'Switch UI language between Portuguese and English.',
  tooltipViewPr: 'Open the autonomously generated hotfix Pull Request on GitHub.',
  tooltipSimulateDecision:
    'Simulates on-call approval in demo mode (production requires the email HMAC link).',
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
  resendDispatchedBadge: 'Post-Mortem email dispatched to on-call engineer via Resend',
  resendDispatchedBody:
    'HMAC-signed decision link delivered exclusively inside the email URL #fragment.',
  resendDegradedTitle: '⚠️ Resend Delivery in Degraded Mode',
  resendDegradedBody:
    'The Resend API rejected the configured sender domain (HTTP 403/delivery error). The incident remains active for simulated decision in the dashboard.',
  healthyTrafficStartBtn: '▶ Healthy Traffic',
  healthyTrafficStopBtn: '⏹ Stop Traffic',
  tooltipHealthyTraffic:
    'Starts or stops continuous healthy traffic on api-pagamentos-core to demonstrate Before → During → After.',
  tooltipHealthyTrafficRequiresRestore:
    'Target service is degraded (v2.14.8). Click "Restore Service" before starting healthy traffic.',
  targetTelemetryLabel: 'Target Telemetry',
  targetRpsLabel: 'Req/s',
  targetError5xxLabel: '5xx Error',
  targetP95Label: 'p95 Latency',
  targetPoolLabel: 'DB Pool',
  healthyTrafficActiveBadge: 'Traffic Active',
  healthyTrafficIdleBadge: 'Idle',
  toastHealthyTrafficStartedSummary: 'Healthy traffic started',
  toastHealthyTrafficStartedDetail: 'Continuous PIX requests streaming to api-pagamentos-core.',
  toastHealthyTrafficStoppedSummary: 'Healthy traffic stopped',
  toastHealthyTrafficStoppedDetail: 'Continuous request stream stopped.',
  targetPoolActiveLabel: 'Active',
  targetPoolWaitingLabel: 'Waiting',
  targetSloLatencyHint: 'SLO: ≤ 500ms',
  targetSlaErrorOk: 'Healthy SLA',
  targetSlaErrorBreach: '5xx Errors Active',
  chartLatencyErrorTitle: 'p95 Latency (ms) & 5xx Error Rate (%)',
  chartThroughputPoolTitle: 'Throughput (req/s) & DB Pool Usage',
  chartPoolGaugeLabel: 'Pool Saturation',
  chartFinopsGaugeLabel: 'FinOps Reduction',
  chartFinopsBarsTitle: 'LLM Payload (Raw vs Compacted)',
  chartMttrBarsTitle: 'Autonomous vs Manual MTTR (~30m)',
  chartAwaitingSamples: 'Awaiting live target service samples (2s polling)...',
  chartSloThreshold: 'SLO 500ms',
  headerMenuBtn: 'Menu',
  headerMenuAriaLabel: 'Toggle command menu'
};

/**
 * Signal-based internationalization service switching dashboard copy between Portuguese and English.
 */
@Injectable({
  providedIn: 'root'
})
export class I18nService {
  readonly currentLang = signal<Language>('pt');

  readonly dict = computed<TranslationDictionary>(() => {
    if (this.currentLang() === 'pt') {
      return PT_TRANSLATIONS;
    }
    return EN_TRANSLATIONS;
  });

  /**
   * Switches the active UI language signal.
   */
  setLang(lang: Language): void {
    this.currentLang.set(lang);
  }

  /**
   * Resolves a localized string for the given translation key.
   */
  t(key: keyof TranslationDictionary): string {
    return this.dict()[key];
  }
}
