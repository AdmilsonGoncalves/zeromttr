# TECH 08 — War Room Dashboard Enxuto (Fase 4b)

**Depende de:** contrato da §4 deste documento. Desenvolvido contra servidor mock e integrado ao orquestrador ([05](./05_orchestrator.md)) ao final.
**Objetivo:** construir uma interface enxuta de tela única (**Single-Pane "War Room Dashboard"**) focada estritamente no roteiro de demonstração de 3 minutos, com estética **Dark-First Mission Control** (`slate-950`, bordas `border-slate-800` e fontes monoespaçadas para traces, logs e diffs).

## 1. Stack Enxuta (Foco no Caminho Crítico de 3 Minutos)

| Item | Decisão |
| :--- | :--- |
| Framework | **Angular (última versão estável)** — Standalone Components, Signals, control flow `@if/@for`, `--ssr=false` |
| UI Components | **PrimeNG** (`primeng`, `@primeuix/themes` preset **Aura Dark**, `primeicons`) |
| Estilo | **Tailwind CSS v4** + `tailwindcss-primeui` (`slate-950` de fundo, `border-slate-800`) |
| Componentes utilizados | `p-toolbar`, `p-selectbutton`, `p-tag`, `p-button`, `p-timeline`, `p-tabs`, `p-progressbar`, `p-card`, `p-dialog` (usando elementos nativos estilizados com Tailwind para a árvore de spans e console de logs a fim de reduzir complexidade) |
| Internacionalização (i18n) | **Signal estático (`I18nService`)** em arquivo único (~40 linhas, zero dependências externas) com seletor `<p-selectbutton>` (`🇧🇷 PT` \| `🇺🇸 EN`) no Header |
| Servidor Mock | `apps/dashboard/mock-server/` (Node puro) emitindo SSE e REST conforme o contrato da §4 |

## 2. Arquitetura de Tela: 4 Quadrantes + Rota `/decision/:id`

A rota principal `/` (`WarRoomComponent`) exibe os 4 quadrantes alimentados via SSE, e a rota `/decision/:id` (`DecisionComponent`) processa exclusivamente os links assinados via HMAC abertos a partir do e-mail do Resend:

| Quadrante / Rota | Conteúdo em Tempo Real |
| :--- | :--- |
| **Q1 — Topo (Header, KPIs, FinOps & Simulador)** | Status SSE (`p-tag`), contador **FinOps / Payload Reduction** (`💰 Payload Reduction: <calculado>% (Est. ~<N>k tokens saved)`), seletor **`[ ⚡ Live API Mode \| 🎬 Replay Mode (Recorded) ]`** (com aviso claro quando em modo Replay público e campo opcional para `X-Live-Demo-Key`), seletor `[ 🇧🇷 PT \| 🇺🇸 EN ]`, indicadores `TTD` / `TTPR`, status do serviço `api-pagamentos-core` e botão **`💥 Simular Incidente`** (+ botão Restaurar). |
| **Q2 — Esquerda (Pipeline ao Vivo)** | `p-timeline` vertical acompanhando as etapas:<br/>1. *Webhook Grafana Recebido*<br/>2. *PromQL (+25%) + Exemplar `trace_id` (+25%) coletados*<br/>3. *Span Crítico isolado no Tempo (+25%)*<br/>4. *Log mascarado extraído do Loki*<br/>5. *Deploy Diff (`v2.14.7...v2.14.8`) inspecionado no GitHub (+25% ⇒ 4/4 Sinais)*<br/>6. *Prompt validado pelo `PiiPromptGuard` (Fail-Closed: 0 Leaked)*<br/>7. *Síntese RCA/Patch (`reasoningSource: llm`) & PR aberto no GitHub*<br/>8. *Post-Mortem com link HMAC (`#fragment`) enviado via Resend* |
| **Q3 — Centro (Evidências OTel + Prova de Mascaramento PII + Git Diff)** | `p-tabs` com 3 abas:<br/>• **Aba 1 (Trace Tree, Evidence Coverage, Reasoning Source & Blast Radius):** barra de cobertura **`Evidence Coverage: 4/4 Signals (100%)`** (ou `3/4 Signals (75%)` em cobertura parcial), badge dinâmico de **`Reasoning Source`** refletindo `rca.reasoningSource` (**`Gemini LLM`** quando `'llm'` ou **`Deterministic Fallback`** quando `'fallback'`), tags de **Blast Radius** (`services_involved`) e lista hierárquica de spans destacando `pg.pool.acquire` (`4.71s ERROR`)<br/>• **Aba 2 (Loki Logs & Prova de Mascaramento de PII):** comparativo lado a lado:<br/>&nbsp;&nbsp;🔴 **Log Reportado na Aplicação (Pré-Collector):** `...payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99...`<br/>&nbsp;&nbsp;🟢 **Log no Loki / Agente MCP (Pós-OTTL `transform`):** `...payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ]...`<br/>&nbsp;&nbsp;+ selo técnico dinâmico refletindo `rca.piiGuardAudit` (**`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`** quando `passed: true`, ou alerta vermelho **`Fail-Closed Triggered (<N> Leaked Patterns Blocked — Routed to Local Fallback)`** quando `passed: false`)<br/>• **Aba 3 (Git Deploy Diff `v2.14.7...v2.14.8` & FinOps):** diff real extraído de `apps/target-app-demo/src/repositories/payment.repository.ts` e estatística de bytes reduzidos por política |
| **Q4 — Direita (Pull Request no GitHub + Governança Resend)** | Card com link direto para o **Pull Request real aberto no GitHub** (`hotfix/zeromttr-*`), preview sanitizado do e-mail enviado pelo **Resend**, indicador **`🔒 Aguardando decisão via link HMAC enviado por e-mail ao plantonista`** e botão secundário explicitamente rotulado como **`[Modo Simulação] Simular Aprovação do Plantonista`** (`POST /api/demo/simulate-decision`). |
| **Rota `/decision/:id`** | Página aberta pelo clique no botão do e-mail real enviado pelo Resend (`/decision/:id#action=approve\|reject&sig=<HMAC>&exp=<TS>`), que lê os parâmetros do `window.location.hash` (sem expor `sig` em logs HTTP) e confirma a decisão via `POST /api/incidents/:id/decision`. |

## 3. Contrato com o Orquestrador (Fonte de Verdade)

### 3.1 REST
| Método e Rota | Resposta / Comportamento |
| :--- | :--- |
| `GET /api/incidents` | `Incident[]` (resumo, mais recente primeiro) |
| `GET /api/incidents/:id` | `IncidentDetail` (**nunca** inclui `decisionToken` / `sig`) |
| `POST /api/demo/chaos` | corpo `{ "mode": "live" \| "replay" }` (cabeçalho opcional `X-Live-Demo-Key`) → `202` |
| `POST /api/demo/reset` | `202` — restaura o serviço-alvo e fecha PRs de demo no repositório-alvo |
| `GET /api/target/status` | `{ "status": "healthy" \| "degraded", "service": "api-pagamentos-core", "version": "v2.14.8", "previousHealthyVersion": "v2.14.7", "rawEdgeLogPreCollector"?: string }` |
| `POST /api/incidents/:id/decision` | corpo `{ "action": "approve" \| "reject", "sig": "<HMAC>", "exp": 1730000000 }` → `200` (usado exclusivamente pela rota `/decision/:id` aberta a partir do e-mail) |
| `POST /api/demo/simulate-decision` | corpo `{ "incidentId": string, "action": "approve" \| "reject" }` → `200` (usado pelo botão `[Modo Simulação]` no Q4 durante replay/demo) |

### 3.2 SSE — `GET /api/events`
| Evento | Payload |
| :--- | :--- |
| `incident.created` | `{ incidentId, service, severity, mode, at }` |
| `incident.transition` | `{ incidentId, from, to, at, reason? }` |
| `incident.rca` | `{ incidentId, summary, reasoningSource: 'llm' \| 'fallback', evidenceCoveragePercent, signalsCollected, signalsTotal, evidenceBreakdown, blastRadius[], diagnosisSeconds, traceId, criticalSpan, spans[], rawEdgeLogPreCollector?, logSample, piiGuardAudit: { leakedPatternsDetected: number; edgeRedactedTokensVerified: number; passed: boolean }, deployVersion?, mitigations[], grafanaAnnotationId? }` |
| `incident.finops` | `{ incidentId, rawBytesFetched, compactedBytesSent, payloadReductionPercent, estimatedTokensSaved }` |
| `incident.docs` | `{ incidentId, sources: [{ url, title, markdownExcerpt }] }` |
| `incident.remediation` | `{ incidentId, branchUrl, pullRequestUrl?, commitSha? }` |
| `incident.notified` | `{ incidentId, emailId, htmlPreview? }` (**sem** `decisionToken` / `sig`) |
| `incident.decision` | `{ incidentId, action, source: 'email_hmac' \| 'demo_simulation' }` |
| `heartbeat` | `{ at }` a cada 15 s |

### 3.3 Tipos TypeScript (`apps/dashboard/src/app/core/contract.ts`)
```ts
export type IncidentState =
  | 'RECEIVED'
  | 'INVESTIGATING'
  | 'ENRICHING'
  | 'REMEDIATING'
  | 'AWAITING_PR'
  | 'NOTIFIED'
  | 'RESOLVED'
  | 'REJECTED'
  | 'FAILED';

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
}

export interface PiiGuardAudit {
  leakedPatternsDetected: number;
  detectedTypes?: string[];
  edgeRedactedTokensVerified: number;
  passed: boolean;
}

export interface Incident {
  id: string;
  service: string;
  severity: string;
  state: IncidentState;
  mode?: 'live' | 'replay';
  startedAt: string;
}

export interface IncidentDetail extends Incident {
  transitions: { from: IncidentState | null; to: IncidentState; at: string; reason?: string }[];
  rca?: {
    summary: string;
    reasoningSource: 'llm' | 'fallback';
    evidenceCoveragePercent: number;
    signalsCollected: number;
    signalsTotal: number;
    evidenceBreakdown?: { promql: number; exemplar: number; tempoSpan: number; lokiAndDiff: number };
    blastRadius: string[];
    diagnosisSeconds: number;
    traceId: string;
    criticalSpan: string;
    spans: SpanNode[];
    rawEdgeLogPreCollector?: string;
    logSample: string;
    piiGuardAudit: PiiGuardAudit;
    deployVersion?: string;
    mitigations: string[];
    grafanaAnnotationId?: number;
  };
  finops?: {
    rawBytesFetched: number;
    compactedBytesSent: number;
    payloadReductionPercent: number;
    estimatedTokensSaved: number;
  };
  docs?: { url: string; title: string; markdownExcerpt: string }[];
  remediation?: { branchUrl: string; pullRequestUrl?: string; commitSha?: string };
  notification?: { emailId: string; htmlPreview?: string };
  decision?: 'approve' | 'reject';
  decisionSource?: 'email_hmac' | 'demo_simulation';
}
```

## 4. Critérios de Aceite
- [ ] `ng build` e `ng test` passam; ESLint e Prettier sem erros.
- [ ] Seletor `[ 🇧🇷 PT | 🇺🇸 EN ]` alterna os rótulos fixos instantaneamente sem reload via `I18nService`.
- [ ] O modo `Replay` exibe aviso claro de que está reproduzindo uma execução real gravada, enquanto o modo `Live` aciona o pipeline real.
- [ ] Aba 1 exibe **`Evidence Coverage: 4/4 Signals (100%)`** e **`Reasoning Source`**; Aba 2 exibe o comparativo de mascaramento OTTL + badge **`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`**; Aba 3 exibe o diff `v2.14.7...v2.14.8` de `apps/target-app-demo`.
- [ ] Nenhum `decisionToken` ou assinatura HMAC trafega no SSE ou em `GET /api/incidents/:id`; a rota `/decision/:id` lê `#action=...&sig=...&exp=...` do `window.location.hash` e confirma a decisão via `POST`.
