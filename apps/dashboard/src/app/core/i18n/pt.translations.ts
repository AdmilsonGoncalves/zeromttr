import type { TranslationDictionary } from './i18n.types.js';

export const PT_TRANSLATIONS: TranslationDictionary = {
  // === App, Header & Mode Controls ===
  appTitle: 'ZeroMTTR — War Room',
  appSubtitle: 'Remediação Autônoma de Incidentes & Governança Humana',
  headerMenuBtn: 'Menu',
  headerMenuAriaLabel: 'Abrir demonstração',
  sseConnected: 'SSE Conectado',
  sseOffline: 'SSE Desconectado',
  targetStatusUnknown: 'Alvo: --',
  unreachable: 'Inacessível',
  demoMenuBtn: 'Demonstração',
  demoMenuTitle: 'Demonstração',
  demoMenuSubtitle: 'Configure o modo de execução, tráfego sintético e simulação de incidentes.',
  demoMenuModeSection: 'Modo de Execução',
  demoMenuLiveToggleLabel: 'Modo Live (APIs Reais)',
  demoMenuLiveDesc: 'Ativo — usa Gemini, GitHub e Resend reais contra o serviço alvo.',
  demoMenuReplayDesc: 'Desligado — reproduz execução real gravada (Replay) sem consumir cotas.',
  demoMenuLiveKeyLabel: 'Chave do Modo Live',
  demoMenuKeyRequiredBadge: 'Obrigatória',
  demoMenuKeyOptionalBadge: 'Não exigida',
  demoMenuKeyNotRequiredHint: 'Desabilitada — o servidor está configurado para Modo Live público.',
  demoMenuKeyReplayHint: 'Ative o Modo Live acima para editar a chave de autorização.',
  demoMenuKeySavedHint: 'Persistida no navegador e enviada no cabeçalho X-Live-Demo-Key.',
  demoMenuTrafficSection: 'Tráfego Sintético',
  demoMenuTrafficToggleLabel: 'Gerar tráfego saudável contínuo',
  demoMenuTrafficReplayHint: 'Disponível apenas quando o Modo Live está ativado.',
  demoMenuActionsSection: 'Ações do Cenário',
  demoModeShortLive: 'Live',
  demoModeShortReplay: 'Replay',
  tooltipDemoMenuBadge:
    'Abre o painel lateral com controles do ambiente de demonstração e simulação.',
  liveMode: '⚡ Live API Mode',
  replayMode: '🎬 Replay Mode (Gravado)',
  liveKeyPlaceholder: 'Chave X-Live-Demo-Key...',
  simulateIncident: '💥 Simular Incidente',
  restoreService: '🔄 Restaurar Serviço',
  serviceStatusLabel: 'Serviço Alvo',
  healthy: 'Saudável',
  degraded: 'Degradado',

  // === KPIs & FinOps Summary ===
  kpiTtdLabel: 'TTD (Diagnóstico)',
  kpiTtprLabel: 'TTPR (PR Pronto)',
  kpiTtdTarget: 'Meta: ≤ 15s (Manual: ~15min)',
  kpiTtprTarget: 'Meta: ≤ 30s (Manual: ~30min)',
  finopsPayloadReduction: '💰 Redução de Payload',
  finopsTokensSaved: 'Tokens poupados',
  finopsBytesFetched: 'Bytes Brutos Coletados',
  finopsBytesSent: 'Bytes Compactados Enviados',

  // === Pipeline & Remediation Steps ===
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

  // === Remediation Flow & Hints ===
  fsmFlowLabel: 'Fluxo de Remediação',
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
  fsmHintIdle: 'Pronto — monitorando telemetria e aguardando incidentes ou execução sob demanda.',
  fsmHintAwaitingAlert:
    'Serviço degradado — gerando tráfego PIX e aguardando Prometheus/Grafana disparar o alerta ({N}s)...',
  fsmHintActive: 'Pipeline autônomo em execução — acompanhando etapas do incidente em tempo real.',
  fsmHintNotified: 'Aguardando decisão humana via link HMAC no e-mail (ou simulação no painel).',
  fsmHintResolved: 'Incidente aprovado e resolvido.',
  fsmHintRejected: 'Hotfix rejeitado pelo plantonista. O PR permanece sem merge.',
  fsmHintFailed: 'Pipeline interrompido por falha — verifique os logs do orquestrador.',

  // === Evidence Tabs, PII Guard & Git/PR ===
  tabTraceTree: 'Trace Tree & Evidências',
  tabLokiLogs: 'Logs Loki & Mascaramento PII',
  tabGitDiff: 'Git Deploy Diff & FinOps',
  tabLiveMetrics: 'Telemetria ao Vivo',
  evidenceCoverageLabel: 'Cobertura de Evidências',
  reasoningSourceLabel: 'Fonte do Diagnóstico',
  reasoningSourceLlm: 'Gemini LLM',
  reasoningSourceFallback: 'Fallback Determinístico',
  blastRadiusLabel: 'Blast Radius (Serviços Afetados)',
  preCollectorLogLabel: '🔴 Log Reportado na Aplicação (Pré-Collector c/ PII Bruta)',
  postOttlLogLabel: '🟢 Log no Loki / Agente MCP (Pós-OTTL transform Mascarado)',
  piiGuardVerifiedBadge: 'PII Mascarada na Borda — Guarda Fail-Closed OK (0 vazamentos)',
  piiGuardBlockedBadge: 'Guarda Fail-Closed Acionada ({N} vazamentos bloqueados — Fallback Local)',
  piiLogWithheldMessage: '[RETIDO POR VIOLAÇÃO PII: {TYPES}]',
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  gitDiffIdleBody: 'Nenhum diff de regressão em análise — serviço saudável.',
  githubPrTitle: 'Pull Request Aberto no GitHub',
  githubPrViewBtn: 'Ver PR no GitHub ↗',
  githubPrIdleStatus: 'Nenhum',
  githubPrOpenStatus: 'Aberto',
  githubPrApprovedStatus: 'Aprovado',
  githubPrRejectedStatus: 'Rejeitado',
  githubPrClosedStatus: 'Fechado',
  githubPrIdleBody: 'Nenhum Pull Request ativo — aguardando etapa de remediação.',
  traceTreeIdleBody: 'Nenhum trace ativo — aguardando coleta de spans no Tempo.',
  traceTreeAwaitingBody: 'Coletando spans distribuídos no Tempo...',
  awaitingAuditBadge: 'Aguardando auditoria...',
  piiIdleBadge: 'Nenhum incidente ativo',
  piiIdlePreCollectorLog: 'Nenhum evento de falha ativo no coletor de borda.',
  piiIdlePostOttlLog: 'Nenhum log mascarado coletado no Loki no momento.',

  // === Resend Post-Mortem & Human Decision / HMAC ===
  resendPreviewTitle: 'Post-Mortem Resend (Preview Sanitizado)',
  resendIdleBody:
    'Nenhum incidente ativo no momento — o Post-Mortem sanitizado será exibido aqui após a notificação.',
  resendDefaultTitle: '🚨 Post-Mortem do Incidente ZeroMTTR',
  resendDefaultBody: 'Aguardando aprovação do plantonista via link seguro exclusivo.',
  resendDispatchedBadge: 'E-mail Post-Mortem enviado ao plantonista via Resend',
  resendDispatchedBody:
    'Link de decisão assinado via HMAC entregue exclusivamente no #fragment do e-mail.',
  resendDegradedTitle: '⚠️ Envio Resend em Modo Degradado',
  resendDegradedBody:
    'A API do Resend recusou o domínio remetente configurado (HTTP 403/erro de entrega). O incidente permanece ativo para decisão simulada no painel.',
  awaitingDecisionBadge: 'Aguardando decisão via link HMAC enviado por e-mail ao plantonista',
  simulateDecisionBtn: 'Aprovar Hotfix (Plantonista)',
  decisionPageTitle: 'Confirmação de Decisão de Remediação',
  decisionIncidentIdLabel: 'ID do Incidente:',
  decisionRequestedActionLabel: 'Ação Solicitada:',
  decisionExpirationLabel: 'Expiração:',
  decisionUnknownAction: 'DESCONHECIDA',
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
  hmacMissingFragmentError: 'Fragmento HMAC ausente na URL (#action=...&sig=...&exp=...)',
  hmacInvalidActionError: 'Parâmetro action inválido no hash (esperado approve ou reject)',
  hmacMissingSigError: 'Assinatura sig HMAC ausente no hash',
  hmacInvalidExpError: 'Timestamp exp inválido no hash',
  hmacExpiredError: 'Link de decisão HMAC expirou',

  // === Target Telemetry & Healthy Traffic ===
  healthyTrafficStartBtn: '▶ Tráfego Saudável',
  healthyTrafficStopBtn: '⏹ Parar Tráfego',
  healthyTrafficActiveBadge: 'Tráfego Ativo',
  healthyTrafficIdleBadge: 'Ocioso',
  targetTelemetryLabel: 'Telemetria Alvo',
  targetRpsLabel: 'Req/s',
  targetError5xxLabel: 'Erro 5xx',
  targetP95Label: 'Latência p95',
  targetPoolLabel: 'Pool DB',
  targetPoolActiveLabel: 'Ativas',
  targetPoolWaitingLabel: 'Em espera',
  targetSloLatencyHint: 'SLO: ≤ 500ms',
  targetSlaErrorOk: 'SLA Saudável',
  targetSlaErrorBreach: 'Falhas 5xx Ativas',
  tooltipHealthyTraffic:
    'Inicia ou interrompe fluxo contínuo de requisições saudáveis em {{service}} para demonstrar Antes → Durante → Depois.',
  tooltipHealthyTrafficRequiresRestore:
    'Serviço alvo degradado (v2.14.8). Use "Restaurar Serviço" antes de iniciar o tráfego saudável.',

  // === Charts ===
  chartLatencyErrorTitle: 'Latência p95 (ms) & Taxa de Erro 5xx (%)',
  chartThroughputTitle: 'Vazão (req/s)',
  chartThroughputPoolTitle: 'Vazão (req/s) & {{resource}}',
  chartFinopsBarsTitle: 'Payload LLM (Bruto vs Compactado)',
  chartAwaitingSamples: 'Aguardando amostras ao vivo do serviço alvo (polling 2s)...',

  // === Turnstile & Tooltips ===
  turnstilePendingNotice:
    'Complete a verificação anti-robô (Cloudflare Turnstile) para habilitar os controles de simulação.',
  turnstileVerifiedBadge: 'Humano verificado',
  turnstileLoadFailedNotice: 'Falha ao carregar a verificação Cloudflare Turnstile.',
  turnstileRetryBtn: 'Tentar novamente',
  tooltipTurnstilePending: 'Aguardando conclusão do desafio Cloudflare Turnstile.',
  tooltipModeSelector:
    'Alterna entre Modo Live (Gemini, GitHub e Resend reais) e Modo Replay (execução gravada).',
  tooltipLiveKeyInput:
    'Informe a chave LIVE_DEMO_KEY configurada no servidor para liberar o Modo Live.',
  tooltipSimulateIncident:
    'Inicia o incidente: degrada o serviço alvo (v2.14.8) no Modo Live ou executa a gravação no Modo Replay.',
  tooltipRestoreService:
    'Remove a saturação de pool e restaura o serviço alvo para o estado saudável.',
  tooltipLanguageSelector: 'Seleciona o idioma da interface (Português, Inglês ou Espanhol).',
  userManualAriaLabel: 'Abrir manual de instruções',
  tooltipUserManual: 'Manual de instruções',
  tooltipViewPr: 'Abre o Pull Request de hotfix gerado automaticamente no GitHub.',
  tooltipSimulateDecision:
    'Registra a aprovação do plantonista diretamente pelo painel (em produção, a confirmação exige o link HMAC enviado por e-mail).',

  // === Toasts & Notifications ===
  toastLiveKeyRequiredSummary: 'Chave Live inválida ou não informada',
  toastLiveKeyRequiredDetail:
    'Informe a chave X-Live-Demo-Key válida para executar ações no Modo Live.',
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
  toastActionErrorSummary: 'Falha na ação de demonstração',
  toastActionErrorDetail: 'Não foi possível concluir a operação no orquestrador.',
  toastChaosStartedSummary: 'Incidente disparado',
  toastChaosStartedDetail: 'Simulação iniciada — acompanhe a telemetria ao vivo no War Room.',
  toastServiceRestoredSummary: 'Serviço restaurado',
  toastServiceRestoredDetail: 'O estado de caos foi limpo e o serviço alvo voltou ao normal.',
  toastDecisionApprovedSummary: 'Hotfix aprovado',
  toastDecisionApprovedDetail:
    'Aprovação registrada e incidente resolvido. Os dados permanecem na tela para inspeção.',
  toastHealthyTrafficStartedSummary: 'Tráfego saudável ativado',
  toastHealthyTrafficStartedDetail:
    'Requisições saudáveis contínuas sendo enviadas para {{service}}.',
  toastHealthyTrafficStoppedSummary: 'Tráfego saudável interrompido',
  toastHealthyTrafficStoppedDetail: 'Fluxo contínuo de requisições encerrado.',

  // === System Settings Drawer ===
  settingsBtnAriaLabel: 'Abrir configurações',
  tooltipSystemSettings: 'Configurações',
  settingsDrawerTitle: 'Configurações',
  settingsDrawerSubtitle:
    'Ajuste políticas de alertas, serviço alvo, modelo LLM e consulte o histórico de alterações.',
  settingsLoading: 'Carregando configurações...',
  settingsLoadError:
    'Não foi possível carregar as configurações. Clique em Recarregar para tentar novamente.',
  settingsReadonlyNotice:
    'Modo somente leitura — configure SETTINGS_ADMIN_TOKEN no servidor para habilitar alterações.',
  settingsAdminTokenLabel: 'Token administrativo (X-Settings-Admin-Token)',
  settingsAdminTokenPlaceholder: 'Informe o SETTINGS_ADMIN_TOKEN...',
  settingsTabAlerts: 'Alertas',
  settingsTabTarget: 'Alvo & Diff',
  settingsTabLlm: 'LLM & Ops',
  settingsTabAudit: 'Auditoria',
  settingsRejectionCooldownLabel: 'Cooldown pós-rejeição (segundos)',
  settingsRejectionCooldownHint:
    'Após rejeitar um hotfix (Human Takeover), suprime novos incidentes para o mesmo fingerprint por esta janela (0 desativa).',
  settingsRepeatSuppressionLabel: 'Supressão de repetição (segundos)',
  settingsRepeatSuppressionHint:
    'Intervalo mínimo antes de reabrir incidente para o mesmo fingerprint após encerramento.',
  settingsDecisionTtlLabel: 'TTL de decisão / incidente aberto (segundos)',
  settingsDecisionTtlHint:
    'Validade do link HMAC enviado por e-mail e tempo máximo antes de expirar incidente pendente.',
  settingsAutoRestoreLabel: 'Restaurar serviço alvo ao aprovar',
  settingsAutoRestoreHint:
    'Executa o hook de pós-aprovação no alvo de demonstração. Desative em produção real.',
  settingsTargetServicePathLabel: 'Caminho do serviço no repositório (TARGET_SERVICE_PATH)',
  settingsTargetBaseRefLabel: 'Ref Base (saudável)',
  settingsTargetHeadRefLabel: 'Ref Head (atual)',
  settingsErrorThresholdLabel: 'Limiar de erro 5xx para degradação (%)',
  settingsErrorThresholdHint:
    'Usado pelo provider Prometheus para classificar o serviço alvo como degradado.',
  settingsReadonlySectionTitle: 'Infraestrutura (Somente Leitura via .env)',
  settingsLlmModelLabel: 'Modelo LLM Principal',
  settingsLlmFallbackLabel: 'Modelo LLM Secundário (Fallback)',
  settingsOnCallEmailLabel: 'E-mail do Plantonista (Resend)',
  settingsOnCallEmailHint:
    'Destinatário do post-mortem e links HMAC (mascarado para privacidade). Deixar vazio usa o ON_CALL_ENGINEER_EMAIL padrão do servidor (.env).',
  settingsLogLevelLabel: 'Nível de Log do Orquestrador',
  settingsAuditEmpty: 'Nenhuma alteração de configuração registrada ainda.',
  settingsReloadBtn: 'Recarregar',
  settingsSaveBtn: 'Salvar Configurações',
  settingsSavedSuccess: 'Configurações salvas e aplicadas em tempo real!',
  settingsSaveError: 'Não foi possível salvar as configurações.',
  settingsInvalidAdminTokenError:
    'Token administrativo inválido ou ausente. Verifique o SETTINGS_ADMIN_TOKEN informado.',
  settingsValidationError: 'Um ou mais valores são inválidos. Revise os campos e tente novamente.',
  settingsDisabledValue: 'Desativado'
};
