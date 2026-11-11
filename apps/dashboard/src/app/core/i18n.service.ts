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
  evidenceCoverageLabel: string;
  reasoningSourceLabel: string;
  reasoningSourceLlm: string;
  reasoningSourceFallback: string;
  blastRadiusLabel: string;
  preCollectorLogLabel: string;
  postOttlLogLabel: string;
  piiGuardVerifiedBadge: string;
  piiGuardBlockedBadge: string;
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
  decisionTokenSecurityNote: string;
  backToWarRoom: string;
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
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  finopsBytesFetched: 'Bytes Brutos Coletados',
  finopsBytesSent: 'Bytes Compactados Enviados',
  githubPrTitle: 'Pull Request Aberto no GitHub',
  githubPrViewBtn: 'Ver PR no GitHub ↗',
  resendPreviewTitle: 'Post-Mortem Resend (Preview Sanitizado)',
  awaitingDecisionBadge: '🔒 Aguardando decisão via link HMAC enviado por e-mail ao plantonista',
  simulateDecisionBtn: '[Modo Simulação] Simular Aprovação do Plantonista',
  decisionPageTitle: 'Confirmação de Decisão de Remediação',
  decisionApproveBtn: 'Aprovar Merge do Hotfix',
  decisionRejectBtn: 'Rejeitar Hotfix',
  decisionSuccessMsg: 'Decisão registrada com sucesso via HMAC assinado!',
  decisionErrorMsg: 'Falha ao validar assinatura HMAC ou link expirado.',
  decisionTokenSecurityNote:
    'Nota de Segurança: O token de decisão trafega exclusivamente pelo hash da URL (#fragment) e nunca é exposto em logs HTTP ou servidores intermediários.',
  backToWarRoom: 'Voltar ao War Room Dashboard'
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
  gitDiffTitle: 'Git Deploy Diff (v2.14.7...v2.14.8)',
  finopsBytesFetched: 'Raw Bytes Fetched',
  finopsBytesSent: 'Compacted Bytes Sent',
  githubPrTitle: 'Pull Request Opened on GitHub',
  githubPrViewBtn: 'View PR on GitHub ↗',
  resendPreviewTitle: 'Resend Post-Mortem (Sanitized Preview)',
  awaitingDecisionBadge: '🔒 Awaiting on-call decision via HMAC link dispatched by email',
  simulateDecisionBtn: '[Simulation Mode] Simulate On-Call Approval',
  decisionPageTitle: 'Remediation Decision Confirmation',
  decisionApproveBtn: 'Approve Hotfix Merge',
  decisionRejectBtn: 'Reject Hotfix',
  decisionSuccessMsg: 'Decision successfully registered via signed HMAC!',
  decisionErrorMsg: 'Failed to validate HMAC signature or link has expired.',
  decisionTokenSecurityNote:
    'Security Note: The decision token travels strictly inside the URL hash (#fragment) and is never exposed to HTTP logs or proxy servers.',
  backToWarRoom: 'Back to War Room Dashboard'
};

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

  setLang(lang: Language): void {
    this.currentLang.set(lang);
  }

  t(key: keyof TranslationDictionary): string {
    return this.dict()[key];
  }
}
