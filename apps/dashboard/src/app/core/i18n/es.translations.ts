import type { TranslationDictionary } from './i18n.types.js';

export const ES_TRANSLATIONS: TranslationDictionary = {
  // === App, Header & Mode Controls ===
  appTitle: 'ZeroMTTR — War Room Mission Control',
  appSubtitle: 'Remediación Autónoma de Incidentes y Gobernanza con Humano en el Circuito',
  headerMenuBtn: 'Menú',
  headerMenuAriaLabel: 'Abrir demostración',
  sseConnected: 'SSE Conectado',
  sseOffline: 'SSE Desconectado',
  targetStatusUnknown: 'Objetivo: --',
  unreachable: 'Inaccesible',
  demoMenuBtn: 'Demostración',
  demoMenuTitle: 'Demostración',
  demoMenuSubtitle: 'Configure el modo de ejecución, tráfico sintético y simulación de incidentes.',
  demoMenuModeSection: 'Modo de Ejecución',
  demoMenuLiveToggleLabel: 'Modo Live (APIs Reales)',
  demoMenuLiveDesc: 'Activo — usa Gemini, GitHub y Resend reales contra el servicio objetivo.',
  demoMenuReplayDesc: 'Desactivado — reproduce una ejecución grabada (Replay) sin consumir cuotas.',
  demoMenuLiveKeyLabel: 'Clave del Modo Live',
  demoMenuKeyRequiredBadge: 'Obligatoria',
  demoMenuKeyOptionalBadge: 'No requerida',
  demoMenuKeyNotRequiredHint:
    'Deshabilitada — el servidor está configurado para Modo Live público.',
  demoMenuKeyReplayHint: 'Active el Modo Live arriba para editar la clave de autorización.',
  demoMenuKeySavedHint: 'Guardada en el navegador y enviada en el encabezado X-Live-Demo-Key.',
  demoMenuTrafficSection: 'Tráfico Sintético',
  demoMenuTrafficToggleLabel: 'Generar tráfico saludable continuo',
  demoMenuTrafficReplayHint: 'Disponible solo cuando el Modo Live está activado.',
  demoMenuActionsSection: 'Acciones del Escenario',
  demoModeShortLive: 'Live',
  demoModeShortReplay: 'Replay',
  tooltipDemoMenuBadge:
    'Abre el panel lateral con controles del entorno de demostración y simulación.',
  liveMode: '⚡ Modo Live API',
  replayMode: '🎬 Modo Replay (Grabado)',
  liveKeyPlaceholder: 'Clave X-Live-Demo-Key...',
  simulateIncident: '💥 Simular Incidente',
  restoreService: '🔄 Restaurar Servicio',
  serviceStatusLabel: 'Servicio Objetivo',
  healthy: 'Saludable',
  degraded: 'Degradado',

  // === KPIs & FinOps Summary ===
  kpiTtdLabel: 'TTD (Diagnóstico)',
  kpiTtprLabel: 'TTPR (PR Listo)',
  kpiTtdTarget: 'Meta: ≤ 15s (Manual: ~15min)',
  kpiTtprTarget: 'Meta: ≤ 30s (Manual: ~30min)',
  finopsPayloadReduction: '💰 Reducción de Payload',
  finopsTokensSaved: 'Tokens ahorrados',
  finopsBytesFetched: 'Bytes Brutos Recolectados',
  finopsBytesSent: 'Bytes Compactados Enviados',

  // === Pipeline & Remediation Steps ===
  pipelineTitle: 'Pipeline de Remediación en Vivo',
  step1Title: 'Webhook de Grafana Recibido',
  step1Desc: 'Alerta de anomalía de latencia p99 y tasa de error 5xx recibida de la pila LGTM.',
  step2Title: 'PromQL y Exemplar Trace ID Recolectados',
  step2Desc: 'Serie temporal analizada con reducción FinOps (+25%) y exemplar extraído (+25%).',
  step3Title: 'Span Crítico Aislado en Tempo',
  step3Desc: 'Tempo aisló el span con error pg.pool.acquire de 4.71s (+25%).',
  step4Title: 'Log Enmascarado Extraído de Loki',
  step4Desc: 'Log de error filtrado por trace_id con PII enmascarada en el borde vía OTTL.',
  step5Title: 'Deploy Diff Inspeccionado en GitHub',
  step5Desc:
    'Diff v2.14.7...v2.14.8 correlacionado con el cambio de pool en el repositorio (+25% ⇒ 4/4 Señales).',
  step6Title: 'Prompt Validado por PiiPromptGuard',
  step6Desc: 'Auditoría fail-closed de CPF, CNPJ, PIX y JWT: 0 fugas residuales.',
  step7Title: 'Síntesis RCA/Patch y PR Abierto en GitHub',
  step7Desc: 'Gemini LLM sintetizó la causa raíz quirúrgica y abrió la rama hotfix/zeromttr-*.',
  step8Title: 'Post-Mortem Enviado vía Resend',
  step8Desc:
    'Informe ejecutivo enviado al ingeniero de guardia con enlace HMAC en #fragment para aprobación.',

  // === FSM Flow & Hints ===
  fsmFlowLabel: 'Flujo FSM',
  fsmAwaitingAlertLabel: '0. Colecta LGTM',
  fsmAwaitingAlertTip:
    'Servicio degradado emitiendo telemetría — esperando que Prometheus/Grafana dispare la alerta.',
  fsmReceivedLabel: '1. Recibido',
  fsmReceivedTip: 'Alerta recibida por webhook de Grafana e incidente inicializado.',
  fsmInvestigatingLabel: '2. Investigando',
  fsmInvestigatingTip:
    'Recolección autónoma de PromQL, trazas en Tempo y logs enmascarados en Loki vía MCP.',
  fsmEnrichingLabel: '3. Enriqueciendo',
  fsmEnrichingTip:
    'Inspección del git diff v2.14.7...v2.14.8 y validación de cobertura de señales.',
  fsmRemediatingLabel: '4. Remediando',
  fsmRemediatingTip: 'Auditoría fail-closed de PiiPromptGuard y síntesis de RCA/parche vía LLM.',
  fsmAwaitingPrLabel: '5. Abriendo PR',
  fsmAwaitingPrTip:
    'Creación de la rama hotfix/* y apertura del Pull Request contra la rama de release.',
  fsmNotifiedLabel: '6. Notificado',
  fsmNotifiedTip: 'Post-mortem enviado vía Resend con enlace HMAC exclusivo en #fragment.',
  fsmResolvedLabel: '7. Resuelto',
  fsmResolvedTip: 'Decisión humana registrada e incidente cerrado con éxito.',
  fsmRejectedLabel: '7. Rechazado',
  fsmRejectedTip: 'Decisión de rechazo registrada por el operador.',
  fsmFailedLabel: 'Falló',
  fsmHintIdle: 'Listo — monitoreando telemetría y esperando incidentes o ejecución bajo demanda.',
  fsmHintAwaitingAlert:
    'Servicio degradado — generando tráfico PIX y esperando alerta de Prometheus/Grafana ({N}s)...',
  fsmHintActive:
    'Pipeline autónomo en ejecución — siguiendo transiciones de la FSM en tiempo real.',
  fsmHintNotified:
    'Esperando decisión humana vía enlace HMAC por correo (o simulación en el panel).',
  fsmHintResolved:
    'Incidente resuelto y aprobado. El servicio objetivo fue restaurado automáticamente.',
  fsmHintRejected: 'Hotfix rechazado por el ingeniero de guardia. El PR permanece sin merge.',
  fsmHintFailed: 'Pipeline detenido por fallo — revise los registros del orquestador.',

  // === Evidence Tabs, PII Guard & Git/PR ===
  tabTraceTree: 'Trace Tree y Evidencias',
  tabLokiLogs: 'Logs Loki y Enmascaramiento PII',
  tabGitDiff: 'Git Deploy Diff y FinOps',
  tabLiveMetrics: 'Telemetría en Vivo',
  evidenceCoverageLabel: 'Cobertura de Evidencias',
  reasoningSourceLabel: 'Fuente de Razonamiento',
  reasoningSourceLlm: 'Gemini LLM',
  reasoningSourceFallback: 'Fallback Determinista',
  blastRadiusLabel: 'Blast Radius (Servicios Afectados)',
  preCollectorLogLabel: '🔴 Log en la Aplicación (Pre-Collector con PII sin procesar)',
  postOttlLogLabel: '🟢 Log en Loki / Agente MCP (Post-OTTL transform Enmascarado)',
  piiGuardVerifiedBadge: 'PII Enmascarada en Borde — Guardia Fail-Closed OK (0 filtraciones)',
  piiGuardBlockedBadge:
    'Guardia Fail-Closed Activada ({N} filtraciones bloqueadas — Fallback Local)',
  piiLogWithheldMessage: '[RETENIDO POR VIOLACIÓN DE PII: {TYPES}]',
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  gitDiffIdleBody: 'Ningún diff de regresión en análisis — servicio saludable.',
  githubPrTitle: 'Pull Request Abierto en GitHub',
  githubPrViewBtn: 'Ver PR en GitHub ↗',
  githubPrIdleStatus: 'Ninguno',
  githubPrOpenStatus: 'Abierto',
  githubPrApprovedStatus: 'Aprobado',
  githubPrRejectedStatus: 'Rechazado',
  githubPrClosedStatus: 'Cerrado',
  githubPrIdleBody: 'Ningún Pull Request activo — esperando etapa de remediación.',
  traceTreeIdleBody: 'Ninguna traza activa — esperando recolección de spans en Tempo.',
  traceTreeAwaitingBody: 'Recolectando spans distribuidos en Tempo...',
  awaitingAuditBadge: 'Esperando auditoría...',
  piiIdleBadge: 'Ningún incidente activo',
  piiIdlePreCollectorLog: 'No hay ningún evento de fallo activo en el colector de borde.',
  piiIdlePostOttlLog: 'No se recolectaron logs enmascarados en Loki por el momento.',

  // === Resend Post-Mortem & Human Decision / HMAC ===
  resendPreviewTitle: 'Post-Mortem Resend (Vista Sanitizada)',
  resendIdleBody:
    'No hay ningún incidente activo en este momento — el Post-Mortem sanitizado aparecerá aquí tras el envío.',
  resendDefaultTitle: '🚨 Post-Mortem del Incidente ZeroMTTR',
  resendDefaultBody:
    'Esperando aprobación del ingeniero de guardia mediante enlace seguro exclusivo.',
  resendDispatchedBadge: 'Correo Post-Mortem enviado al ingeniero de guardia vía Resend',
  resendDispatchedBody:
    'Enlace de decisión firmado vía HMAC entregado exclusivamente en el #fragment del correo.',
  resendDegradedTitle: '⚠️ Envío Resend en Modo Degradado',
  resendDegradedBody:
    'La API de Resend rechazó el dominio remitente configurado (HTTP 403/error de entrega). El incidente sigue activo para decisión simulada en el panel.',
  awaitingDecisionBadge: 'Esperando decisión humana vía enlace HMAC enviado por correo al guardia',
  simulateDecisionBtn: 'Aprobar Hotfix (Guardia)',
  decisionPageTitle: 'Confirmación de Decisión de Remediación',
  decisionIncidentIdLabel: 'ID del Incidente:',
  decisionRequestedActionLabel: 'Acción Solicitada:',
  decisionExpirationLabel: 'Expiración:',
  decisionUnknownAction: 'DESCONOCIDA',
  decisionApproveBtn: 'Aprobar Hotfix (Resolver Incidente)',
  decisionRejectBtn: 'Rechazar Hotfix',
  decisionSuccessMsg: '¡Decisión registrada con éxito mediante HMAC firmado!',
  decisionErrorMsg: 'Error al validar la firma HMAC o el enlace ha expirado.',
  decisionAlreadyResolvedError:
    'Este incidente ya fue cerrado anteriormente (estado RESOLVED o REJECTED).',
  decisionAlreadyClosedBanner:
    'Este incidente ya fue procesado y se encuentra cerrado. No se permiten nuevas acciones.',
  decisionConfirmationHelp:
    'Por seguridad y cumplimiento con RFC 7231, se requiere confirmación explícita en esta página para evitar que los rastreadores de correo activen hotfixes automáticamente.',
  decisionTokenSecurityNote:
    'Nota de Seguridad: El token de decisión viaja exclusivamente por el hash de la URL (#fragment) y nunca se expone en registros HTTP ni servidores proxy.',
  backToWarRoom: 'Volver al War Room Dashboard',
  hmacMissingFragmentError: 'Falta el fragmento HMAC en la URL (#action=...&sig=...&exp=...)',
  hmacInvalidActionError: 'Parámetro action inválido en el hash (se esperaba approve o reject)',
  hmacMissingSigError: 'Falta la firma HMAC sig en el hash',
  hmacInvalidExpError: 'Timestamp exp inválido en el hash',
  hmacExpiredError: 'El enlace de decisión HMAC ha expirado',

  // === Target Telemetry & Healthy Traffic ===
  healthyTrafficStartBtn: '▶ Tráfico Saludable',
  healthyTrafficStopBtn: '⏹ Detener Tráfico',
  healthyTrafficActiveBadge: 'Tráfico Activo',
  healthyTrafficIdleBadge: 'Inactivo',
  targetTelemetryLabel: 'Telemetría Objetivo',
  targetRpsLabel: 'Req/s',
  targetError5xxLabel: 'Error 5xx',
  targetP95Label: 'Latencia p95',
  targetPoolLabel: 'Pool DB',
  targetPoolActiveLabel: 'Activas',
  targetPoolWaitingLabel: 'En espera',
  targetSloLatencyHint: 'SLO: ≤ 500ms',
  targetSlaErrorOk: 'SLA Saludable',
  targetSlaErrorBreach: 'Errores 5xx Activos',
  tooltipHealthyTraffic:
    'Inicia o detiene flujo continuo de solicitudes saludables en {{service}} para demostrar Antes → Durante → Después.',
  tooltipHealthyTrafficRequiresRestore:
    'Servicio objetivo degradado (v2.14.8). Use "Restaurar Servicio" antes de iniciar tráfico saludable.',

  // === Charts ===
  chartLatencyErrorTitle: 'Latencia p95 (ms) y Tasa de Error 5xx (%)',
  chartThroughputTitle: 'Rendimiento (req/s)',
  chartThroughputPoolTitle: 'Rendimiento (req/s) y {{resource}}',
  chartFinopsBarsTitle: 'Payload LLM (Bruto vs Compactado)',
  chartAwaitingSamples: 'Esperando muestras en vivo del servicio objetivo (polling 2s)...',

  // === Turnstile & Tooltips ===
  turnstilePendingNotice:
    'Complete la verificación anti-bot (Cloudflare Turnstile) para habilitar los controles de simulación.',
  turnstileVerifiedBadge: 'Humano verificado',
  turnstileLoadFailedNotice: 'Error al cargar la verificación Cloudflare Turnstile.',
  turnstileRetryBtn: 'Reintentar',
  tooltipTurnstilePending: 'Esperando completar el desafío de Cloudflare Turnstile.',
  tooltipModeSelector:
    'Alterna entre Modo Live (Gemini, GitHub y Resend reales) y Modo Replay (ejecución grabada).',
  tooltipLiveKeyInput:
    'Ingrese la clave LIVE_DEMO_KEY configurada en el servidor para habilitar el Modo Live.',
  tooltipSimulateIncident:
    'Inicia el incidente: degrada el servicio objetivo (v2.14.8) en Modo Live o reproduce la grabación en Modo Replay.',
  tooltipRestoreService:
    'Elimina la saturación del pool y restaura el servicio objetivo al estado saludable.',
  tooltipLanguageSelector: 'Cambia el idioma de la interfaz (Portugués, Inglés o Español).',
  tooltipViewPr: 'Abre en GitHub el Pull Request de hotfix generado automáticamente.',
  tooltipSimulateDecision:
    'Registra la aprobación del ingeniero de guardia desde el panel (en producción, la confirmación requiere el enlace HMAC enviado por correo).',

  // === Toasts & Notifications ===
  toastLiveKeyRequiredSummary: 'Clave Live inválida o no informada',
  toastLiveKeyRequiredDetail:
    'Proporcione una clave X-Live-Demo-Key válida para ejecutar acciones en Modo Live.',
  toastCooldownSummary: 'Cooldown activo',
  toastCooldownDetail: 'Espere el intervalo de cooldown antes de activar otro incidente.',
  toastCooldownDetailWithSeconds:
    'Simulación en cooldown. Espere {N} segundos antes de activar de nuevo.',
  toastRateLimitSummary: 'Límite de solicitudes alcanzado',
  toastRateLimitDetail:
    'Demasiadas solicitudes desde esta IP. Espere un momento antes de intentar de nuevo.',
  toastRateLimitDetailWithSeconds:
    'Demasiadas solicitudes desde esta IP. Espere {N} segundos antes de intentar de nuevo.',
  toastTurnstileRequiredSummary: 'Verificación humana requerida',
  toastTurnstileRequiredDetail:
    'Complete nuevamente el desafío de Cloudflare Turnstile antes de ejecutar esta acción.',
  toastActionErrorSummary: 'Error en la acción de demostración',
  toastActionErrorDetail: 'No se pudo completar la operación en el orquestador.',
  toastChaosStartedSummary: 'Incidente activado',
  toastChaosStartedDetail: 'Simulación iniciada — siga la telemetría en vivo en el War Room.',
  toastServiceRestoredSummary: 'Servicio restaurado',
  toastServiceRestoredDetail:
    'El estado de caos fue limpiado y el servicio objetivo volvió a estar saludable.',
  toastDecisionApprovedSummary: 'Hotfix aprobado',
  toastDecisionApprovedDetail:
    '¡Incidente resuelto y servicio objetivo restaurado! Los datos permanecen en pantalla para inspección.',
  toastHealthyTrafficStartedSummary: 'Tráfico saludable activado',
  toastHealthyTrafficStartedDetail: 'Solicitudes saludables continuas enviándose a {{service}}.',
  toastHealthyTrafficStoppedSummary: 'Tráfico saludable detenido',
  toastHealthyTrafficStoppedDetail: 'Flujo continuo de solicitudes finalizado.',

  // === System Settings Drawer ===
  settingsBtnAriaLabel: 'Abrir configuración',
  tooltipSystemSettings: 'Configuración',
  settingsDrawerTitle: 'Configuración',
  settingsDrawerSubtitle:
    'Ajuste políticas de alertas, servicio objetivo, modelo LLM y consulte el historial de cambios.',
  settingsLoading: 'Cargando configuración...',
  settingsLoadError:
    'No se pudo cargar la configuración. Haga clic en Recargar para intentarlo nuevamente.',
  settingsReadonlyNotice:
    'Modo solo lectura — configure SETTINGS_ADMIN_TOKEN en el servidor para habilitar cambios.',
  settingsAdminTokenLabel: 'Token administrativo (X-Settings-Admin-Token)',
  settingsAdminTokenPlaceholder: 'Ingrese SETTINGS_ADMIN_TOKEN...',
  settingsTabAlerts: 'Alertas',
  settingsTabTarget: 'Objetivo & Diff',
  settingsTabLlm: 'LLM & Ops',
  settingsTabAudit: 'Auditoría',
  settingsRejectionCooldownLabel: 'Cooldown tras rechazo (segundos)',
  settingsRejectionCooldownHint:
    'Tras rechazar un hotfix (Human Takeover), suprime nuevos incidentes para el mismo fingerprint por esta ventana (0 desactiva).',
  settingsRepeatSuppressionLabel: 'Supresión de repetición (segundos)',
  settingsRepeatSuppressionHint:
    'Intervalo mínimo antes de reabrir un incidente para el mismo fingerprint tras el cierre.',
  settingsDecisionTtlLabel: 'TTL de decisión / incidente abierto (segundos)',
  settingsDecisionTtlHint:
    'Validez del enlace HMAC enviado por correo y tiempo máximo antes de expirar un incidente pendiente.',
  settingsAutoRestoreLabel: 'Restaurar objetivo al aprobar',
  settingsAutoRestoreHint:
    'Ejecuta el hook de restauración tras aprobación en el entorno demo. Desactívelo en producción real.',
  settingsTargetServicePathLabel: 'Ruta del servicio en el repositorio (TARGET_SERVICE_PATH)',
  settingsTargetBaseRefLabel: 'Ref Base (saludable)',
  settingsTargetHeadRefLabel: 'Ref Head (actual)',
  settingsErrorThresholdLabel: 'Umbral de error 5xx para degradación (%)',
  settingsErrorThresholdHint:
    'Usado por el proveedor Prometheus para clasificar el servicio objetivo como degradado.',
  settingsReadonlySectionTitle: 'Infraestructura (Solo Lectura desde .env)',
  settingsLlmModelLabel: 'Modelo LLM Principal',
  settingsLlmFallbackLabel: 'Modelo LLM Secundario (Fallback)',
  settingsOnCallEmailLabel: 'Correo del Guardia (Resend)',
  settingsOnCallEmailHint:
    'Destinatario de post-mortems y enlaces HMAC (enmascarado por privacidad). Dejarlo vacío usa el ON_CALL_ENGINEER_EMAIL predeterminado del servidor (.env).',
  settingsLogLevelLabel: 'Nivel de Log del Orquestador',
  settingsAuditEmpty: 'Aún no hay cambios de configuración registrados.',
  settingsReloadBtn: 'Recargar',
  settingsSaveBtn: 'Guardar Configuración',
  settingsSavedSuccess: '¡Configuración guardada y aplicada en tiempo real!',
  settingsSaveError: 'No se pudo guardar la configuración.',
  settingsInvalidAdminTokenError:
    'Token administrativo inválido o ausente. Verifique el SETTINGS_ADMIN_TOKEN ingresado.',
  settingsValidationError:
    'Uno o más valores son inválidos. Revise los campos e inténtelo de nuevo.',
  settingsDisabledValue: 'Desactivado'
};
