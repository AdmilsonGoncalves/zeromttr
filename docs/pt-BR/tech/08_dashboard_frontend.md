# TECH 08 — Dashboard (Frontend War Room) — agente dedicado (Fase 4b)

**Depende de:** o **contrato da §4** deste documento (não do orquestrador pronto). O frontend é desenvolvido contra um servidor mock e integrado ao orquestrador ([05](./05_orchestrator.md)) no fim.
**Objetivo:** construir uma tela única de comando (**Single-Pane-of-Glass "War Room Dashboard"**) com estética **Dark-First Mission Control** (`slate-950`/`zinc-950`, bordas `border-slate-800`, fontes monoespaçadas para `trace_id`/logs/diffs e indicadores pulsantes SSE) para operação e monitoramento de incidentes em tempo real.

## 1. Stack e Design System (Sem bloat de template administrativo)

Em vez de clonar templates administrativos pesados, o projeto parte de um `ng new` limpo na última versão estável com **PrimeNG (preset Aura Dark) + Tailwind CSS**.

| Item | Decisão |
| :--- | :--- |
| Framework | **Angular, última versão estável** (Standalone Components, Signals, control flow `@if/@for`, `--ssr=false`) |
| UI Components | **PrimeNG** (`primeng`, `@primeuix/themes` com preset **Aura** configurado em Dark Mode, `primeicons`) |
| Estilo | **Tailwind CSS v4** + plugin oficial `tailwindcss-primeui` (`slate-950` de fundo, `border-slate-800`) |
| Componentes-chave | `p-toolbar`, `p-selectbutton`, `p-tag`, `p-button`, `p-timeline`, `p-tabs`, `p-tree` / `p-treeTable`, `p-knob` / `p-progressbar`, `p-card`, `p-panel`, `p-dialog` |
| Internacionalização (i18n) | **Signal estático (`I18nService`)** com `signal<Lang>('en-US')` + `computed()` em arquivo único (~40 linhas, **zero** bibliotecas externas como `@ngx-translate` ou `@angular/localize`) e seletor `<p-selectbutton>` (`🇧🇷 PT` \| `🇺🇸 EN`) no Header |
| Testes | Runner padrão (`ng test`); componentes e serviços testados, SSE testado com fake |
| Servidor mock | `apps/dashboard/mock-server/` (Node, sem dependências pesadas) emitindo SSE e REST conforme o contrato |

## 2. Responsabilidade e limites do agente

- **Escreve apenas** em `apps/dashboard/` (e em `docs/pt-BR/adr/` para suas decisões). **Não altera** `apps/orchestrator/`, `apps/mcp-server/` nem `infra/`.
- Se precisar de mudança no contrato, **propõe** a alteração em `apps/dashboard/CONTRACT_CHANGES.md` e o desenvolvedor aplica no orquestrador.
- Código, rótulos técnicos e testes em en-US; os ~25 rótulos fixos da interface são traduzidos instantaneamente sem reload via `I18nService` (dicionário estático em TypeScript com `signal` + `computed`, iniciando em `en-US` com alternância em 1 clique para `pt-BR`). Dados técnicos (logs, nomes de spans, PromQL e diffs de código) não são traduzidos.

## 3. Arquitetura de Tela: Single-Pane "War Room" (4 Quadrantes) + Rota de Decisão

Para proporcionar visibilidade operacional imediata sem navegação por menus laterais, a rota principal `/` (`WarRoomComponent`) concentra toda a operação em **4 quadrantes em tempo real via SSE**, acompanhada apenas da rota `/decision/:id` para confirmação de links vindos do e-mail:

| Quadrante / Rota | Componentes PrimeNG | Conteúdo em Tempo Real |
| :--- | :--- | :--- |
| **Q1 — Topo (Header, KPIs, FinOps & Simulador)** | `p-toolbar`, `p-selectbutton`, `p-tag`, `p-button` | Status da conexão SSE (`p-tag` pulsante), contador **FinOps / Token Economy** (`💰 Context Compression: 94.2% (Saved ~48k tokens)`), seletor de modo **`[ ⚡ Live API Mode \| 🎬 Accelerated Replay Mode ]`** (`p-selectbutton`), seletor de idioma `[ 🇧🇷 PT \| 🇺🇸 EN ]`, cards de KPIs (`MTTD`, `MTTR`, status do `api-pagamentos-core`) e botão vermelho **`p-button` (`severity="danger"`, `[loading]="isSimulating()"`) "💥 Simular Incidente em Produção"** (+ botão Restaurar) |
| **Q2 — Esquerda (Pipeline Agêntico ao Vivo)** | `p-timeline` | Linha vertical gerada com `@for` sobre os passos da FSM / tools do MCP, mudando de cor/ícone (cinza → azul pulsante → verde):<br/>1. *Webhook Grafana Recebido*<br/>2. *PromQL (+25%) + Exemplar `trace_id` (+25%) capturados*<br/>3. *Span Crítico isolado no Tempo (+25% conf.)*<br/>4. *Log sanitizado extraído do Loki*<br/>5. *Deploy Diff (`v2.14.7...v2.14.8`) inspecionado no GitHub (+20% conf. ⇒ 95%)*<br/>6. *Anotação injetada no Grafana (`/api/annotations`)*<br/>7. *Patch gerado & Pull Request aberto no GitHub*<br/>8. *Post-Mortem enviado via Resend* |
| **Q3 — Centro (Evidências OTel + PII Proof + Git Deploy Diff)** | `p-tabs`, `p-tree` / `p-treeTable`, `p-knob` / `p-progressbar` | Divide as 3 evidências técnicas coletadas pelo MCP:<br/>• **Aba 1 (Trace Tree, Confidence & Blast Radius):** medidor circular `p-knob` / `p-progressbar` do **RCA Confidence Score (95%)**, badges de **Blast Radius** (`services_involved` afetados em cascata) e hierarquia de spans do Grafana Tempo (`analyze_otel_trace`), destacando em vermelho o span gargalo (`pg.pool.acquire` com `4.71s`)<br/>• **Aba 2 (Loki Logs & Prova Visual Antes vs. Depois de PII):** console escuro monoespaçado com comparativo lado a lado:<br/>&nbsp;&nbsp;🔴 **Payload Bruto Emitido na Aplicação:** `User CPF 123.456.789-00 failed checkout...`<br/>&nbsp;&nbsp;🟢 **Log Recebido pelo Agente MCP (Pós-OTel Collector):** `User CPF **** failed checkout...`<br/>&nbsp;&nbsp;+ badge verde **`Zero PII Leaked to External LLMs (LGPD Compliant)`**<br/>• **Aba 3 (Git Deploy Diff `v2.14.7...v2.14.8` & FinOps):** diff do commit causador da regressão extraído via GitHub API (`inspect_git_deploy_diff`), link para o commit/arquivo no GitHub e estatística de bytes/tokens economizados |
| **Q4 — Direita (Auto-Remediação GitHub PR + Resend)** | `p-card`, `p-panel`, `p-dialog` | Status da branch `hotfix/zeromttr-*`, confirmação da anotação no Grafana (`aiops-remediation`), botão direto para abrir o **Pull Request real no GitHub** (validado pelo workflow `hotfix-verify.yml`), preview do relatório *Post-Mortem* enviado pelo **Resend** (expansível em `p-dialog`) e botões de aprovação/rejeição humana |
| Rota `/decision/:id` | `p-card`, `p-button` | Página enxuta de confirmação aberta pelo link do e-mail do Resend (Aprovar / Rejeitar via `POST` com assinatura HMAC) |

Requisitos de UX: Dark-First (`slate-950`), responsivo, estados de carregamento/erro, reconexão automática do SSE, acessibilidade básica (foco visível, contraste, `aria-live` para novos eventos).

## 4. Contrato com o orquestrador (fonte de verdade)

Base: `/api` (o contêiner do dashboard faz proxy reverso para `orchestrator:8080`, evitando CORS).

### 4.1 REST
| Método e rota | Resposta |
| :--- | :--- |
| `GET /api/incidents` | `Incident[]` (resumo, mais recente primeiro) |
| `GET /api/incidents/:id` | `IncidentDetail` |
| `POST /api/demo/chaos` | corpo `{ "mode": "live" \| "replay", "liveKey"?: string }` → `202` — liga a falha no serviço-alvo (ou dispara o stream determinístico de 25 s em modo `replay`) |
| `POST /api/demo/reset` | `202` — restaura o serviço-alvo |
| `GET /api/target/status` | `{ "status": "healthy" \| "degraded", "version": "v2.14.8", "previousHealthyVersion": "v2.14.7", "lastRawUnredactedLogSample"?: string }` |
| `POST /api/incidents/:id/decision` | corpo `{ "action": "approve" \| "reject", "sig": "<HMAC>", "exp": 1730000000 }` → `200` |

### 4.2 SSE — `GET /api/events`
Eventos (`event:` + `data:` JSON):

| Evento | Payload |
| :--- | :--- |
| `incident.created` | `{ incidentId, service, severity, at }` |
| `incident.transition` | `{ incidentId, from, to, at, reason? }` |
| `incident.rca` | `{ incidentId, summary, confidence, confidenceBreakdown, blastRadius[], diagnosisSeconds, traceId, criticalSpan, spans[], rawUnredactedLogSample?, logSample, deployVersion?, mitigations[], grafanaAnnotationId? }` |
| `incident.finops` | `{ incidentId, rawBytesFetched, compactedBytesSent, compressionRatioPercent, estimatedTokensSaved }` |
| `incident.docs` | `{ incidentId, sources: [{ url, title, markdownExcerpt }] }` (contém o diff/commit inspecionado via GitHub API) |
| `incident.remediation` | `{ incidentId, branchUrl, pullRequestUrl?, commitSha? }` |
| `incident.notified` | `{ incidentId, emailId, htmlPreview?, decisionToken?: { approveSig: string; rejectSig: string; exp: number } }` |
| `incident.decision` | `{ incidentId, action }` |
| `heartbeat` | `{ at }` a cada 15 s |

### 4.3 Tipos (TypeScript)
```ts
type IncidentState = 'RECEIVED' | 'INVESTIGATING' | 'ENRICHING' | 'REMEDIATING'
  | 'AWAITING_PR' | 'NOTIFIED' | 'RESOLVED' | 'REJECTED' | 'FAILED';

interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
}

interface Incident {
  id: string;
  service: string;
  severity: string;
  state: IncidentState;
  startedAt: string;
}

interface IncidentDetail extends Incident {
  mode?: 'live' | 'replay';
  transitions: { from: IncidentState | null; to: IncidentState; at: string; reason?: string }[];
  rca?: {
    summary: string;
    confidence: number;
    confidenceBreakdown?: { promql: number; exemplar: number; tempoSpan: number; lokiAndDiff: number };
    blastRadius: string[];
    diagnosisSeconds: number;
    traceId: string;
    criticalSpan: string;
    spans: SpanNode[];
    rawUnredactedLogSample?: string;
    logSample: string;
    deployVersion?: string;
    mitigations: string[];
    grafanaAnnotationId?: number;
  };
  finops?: {
    rawBytesFetched: number;
    compactedBytesSent: number;
    compressionRatioPercent: number;
    estimatedTokensSaved: number;
  };
  docs?: { url: string; title: string; markdownExcerpt: string }[];
  remediation?: { branchUrl: string; pullRequestUrl?: string; commitSha?: string };
  notification?: { emailId: string; htmlPreview?: string };
  decisionToken?: { approveSig: string; rejectSig: string; exp: number };
  decision?: 'approve' | 'reject';
  grafanaUrl?: string;
}
```
Gerar os tipos em `apps/dashboard/src/app/core/contract.ts`; o orquestrador deve expor exatamente esse formato.

### 4.4 Autenticação do SSE
`EventSource` do navegador **não envia cabeçalhos** `Authorization`. O dashboard e o proxy reverso ficam no mesmo host; o proxy (`nginx`) injeta o `Authorization` ao encaminhar `/api/*` para o orquestrador. O código Angular **não** carrega segredos.

## 5. Estrutura de pastas (`apps/dashboard/`)
```text
apps/dashboard/
├── src/app/
│   ├── core/            # contract.ts, api.service.ts, sse.service.ts, i18n
│   ├── features/
│   │   ├── war-room/    # WarRoomComponent (4 quadrantes: header-kpis, agent-timeline, evidence-tabs, remediation-panel)
│   │   └── decision/    # DecisionComponent (confirmação de aprovação/rejeição via link do e-mail)
│   ├── shared/          # state-badge, duration-pipe
│   └── app.routes.ts
├── mock-server/         # SSE + REST conforme contrato, com cenário "golden path"
├── nginx.conf.template  # proxy /api -> orchestrator, injeta Authorization: Bearer ${WEBHOOK_TOKEN} via envsubst
├── Dockerfile           # build Angular + nginx:1.27-alpine
└── test/
```
Estado reativo com **Signals** (`signal`, `computed`, `toSignal`); sem NgRx.

### 5.1 Padrão de Internacionalização (`core/i18n.service.ts`)
Proibido usar `@ngx-translate/core`, carregamento de JSON via HTTP ou `@angular/localize`. Implementar em arquivo único:

```ts
import { Injectable, signal, computed } from '@angular/core';

export type Lang = 'pt-BR' | 'en-US';

const DICTIONARY = {
  'pt-BR': {
    subtitle: 'Motor Autônomo de AIOps & Auto-Remediação',
    simulateBtn: 'Simular Incidente em Produção',
    simulating: 'Injetando Anomalia OTel...',
    restoreBtn: 'Restaurar Serviço',
    sseConnected: 'MCP SSE: Conectado',
    sseDisconnected: 'MCP SSE: Reconectando...',
    piiActive: 'Redação de PII na Borda: Ativa',
    timelineTitle: 'Pipeline Agêntico em Tempo Real',
    evidenceTitle: 'Evidências Correlacionadas (LGTM + Git Deploy Diff)',
    remediationTitle: 'Governança & Auto-Remediação (GitHub PR + Resend)',
    reviewPrBtn: 'Revisar Pull Request no GitHub',
    approveBtn: 'Aprovar Hotfix',
    rejectBtn: 'Rejeitar',
    liveMode: '⚡ Live API Mode',
    replayMode: '🎬 Accelerated Replay (25s)',
    finopsLabel: 'Compressão de Contexto',
    confidenceLabel: 'Confiança Determinística do RCA',
    blastRadiusLabel: 'Raio de Explosão (Blast Radius)',
    rawPiiLabel: 'Payload Bruto Emitido na Aplicação',
    redactedPiiLabel: 'Log Recebido pelo Agente MCP (Pós-OTel Collector)',
    lgpdBadge: 'Zero PII Vazada para LLMs Externos (LGPD Compliant)',
  },
  'en-US': {
    subtitle: 'Autonomous AIOps & Incident Remediation Engine',
    simulateBtn: 'Simulate Production Incident',
    simulating: 'Injecting OTel Anomaly...',
    restoreBtn: 'Restore Service',
    sseConnected: 'MCP SSE: Connected',
    sseDisconnected: 'MCP SSE: Reconnecting...',
    piiActive: 'Edge PII Redaction: Active',
    timelineTitle: 'Real-Time Agentic Pipeline',
    evidenceTitle: 'Correlated Evidence (LGTM + Git Deploy Diff)',
    remediationTitle: 'Governance & Auto-Remediation (GitHub PR + Resend)',
    reviewPrBtn: 'Review Pull Request on GitHub',
    approveBtn: 'Approve Hotfix',
    rejectBtn: 'Reject',
    liveMode: '⚡ Live API Mode',
    replayMode: '🎬 Accelerated Replay (25s)',
    finopsLabel: 'Context Compression',
    confidenceLabel: 'Deterministic RCA Confidence',
    blastRadiusLabel: 'Blast Radius (Impacted Services)',
    rawPiiLabel: 'Raw Payload Emitted at Application Edge',
    redactedPiiLabel: 'Sanitized Log Received by MCP Agent (Post-OTel Collector)',
    lgpdBadge: 'Zero PII Leaked to External LLMs (LGPD Compliant)',
  },
} as const;

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>('en-US');
  readonly t = computed(() => DICTIONARY[this.lang()]);

  toggle() {
    this.lang.update((current) => (current === 'pt-BR' ? 'en-US' : 'pt-BR'));
  }
}
```
No Header, vincular com `<p-selectbutton [options]="[{label: '🇧🇷 PT', value: 'pt-BR'}, {label: '🇺🇸 EN', value: 'en-US'}]" [ngModel]="i18n.lang()" (ngModelChange)="i18n.lang.set($event)" />`.

## 6. Tarefas (ordem para o agente)
1. **Scaffold limpo:** criar projeto Angular em `apps/dashboard/` (`--style=css --ssr=false`), instalar `primeng`, `@primeuix/themes`, `primeicons`, `tailwindcss` e `tailwindcss-primeui` via `pnpm`, configurando o preset `Aura` em Dark Mode (`slate-950` de fundo).
2. **Contrato e mock:** `contract.ts` + `mock-server/` que reproduz o golden path completo (todos os eventos da §4.2 com árvore de spans, log sanitizado, diff de regressão do GitHub, PR autônomo e post-mortem do Resend).
3. **Serviços (TDD):** `I18nService` (dicionário estático em Signal `pt-BR`/`en-US`), `ApiService` e `SseService` (reconexão com backoff, `heartbeat`, conversão de eventos em Signals) testados com fakes.
4. **Quadrante 1 (Topo — KPIs, FinOps, Modo Live/Replay, i18n & Simulador):** status SSE (`p-tag`), contador `💰 Context Compression: 94.2% (Saved ~48k tokens)`, toggle `<p-selectbutton>` (`⚡ Live API Mode` | `🎬 Accelerated Replay (25s)`), seletor `<p-selectbutton>` (`🇧🇷 PT` | `🇺🇸 EN`), indicadores MTTD/MTTR e `p-button` de simulação/restauração de incidente.
5. **Quadrante 2 (Esquerda — Pipeline Agêntico):** `p-timeline` reativo aos estados e às tools do MCP (incluindo confirmação de anotação no Grafana `/api/annotations`) com duração por etapa.
6. **Quadrante 3 (Centro — Evidências OTel + PII Proof + Git Deploy Diff):** `p-tabs` com Aba 1 (`p-knob`/`p-progressbar` de **RCA Confidence Score (95%)**, tags de **Blast Radius** e `p-tree`/`p-treeTable` de spans destacando o span crítico em vermelho), Aba 2 (console escuro monoespaçado com comparativo visual **Antes vs. Depois da Sanitização de PII** + badge verde `Zero PII Leaked to External LLMs (LGPD Compliant)`) e Aba 3 (diff do commit de regressão `v2.14.7...v2.14.8` inspecionado via GitHub API).
7. **Quadrante 4 (Direita — GitHub PR + Resend) & Rota `/decision/:id`:** cards com status da branch/PR no GitHub, preview do post-mortem em `p-dialog` e confirmação de decisão via `POST /api/incidents/:id/decision` (usando `decisionToken` recebido no SSE/`IncidentDetail` quando clicado no Q4, ou `sig`+`exp` da query string quando aberto via `/decision/:id` do e-mail).
8. **Empacotamento e Integração:** `Dockerfile` + `nginx.conf.template` (conforme especificação de [01 §3.2](./01_foundation_and_infrastructure.md)) e validação contra o orquestrador real.

## 7. Segurança
- Sem segredos no bundle; tokens só no proxy (`nginx`).
- Renderizar logs, diffs e textos de LLM de forma segura (sem `innerHTML` não sanitizado).
- Links externos com `rel="noopener noreferrer"`; validar que URLs de PR/GitHub usam `https`.
- Content-Security-Policy restritiva no `nginx.conf.template`.

## 8. Prompt padrão para o agente de frontend
> Leia `AGENTS.md`, `docs/pt-BR/00_architecture_master.md` e `docs/pt-BR/tech/08_dashboard_frontend.md`. Você é o agente de **frontend**: altere somente `apps/dashboard/`. Crie a aplicação Angular limpa (Standalone Components + Signals) com PrimeNG (preset Aura em Dark Mode) e Tailwind CSS usando `pnpm`, e implemente o War Room Dashboard de 4 quadrantes seguindo as tarefas da §6 em ordem, com testes primeiro, usando o contrato da §4 e o servidor mock. Pare a cada tarefa concluída listando os critérios de aceite atendidos.

## 9. Critérios de aceite
- [ ] `ng build` e `ng test` passam na versão estável atual do Angular + PrimeNG; ESLint e Prettier sem erros.
- [ ] Visual **Dark-First Mission Control** (`slate-950`, bordas `border-slate-800`, fontes monoespaçadas para traces/logs/diffs) em tela única de 4 quadrantes.
- [ ] Seletor `[ 🇧🇷 PT | 🇺🇸 EN ]` (`p-selectbutton`) no Header alterna todos os rótulos fixos instantaneamente sem *reload*, via `I18nService` (Signal estático, sem bibliotecas externas de i18n).
- [ ] Toggle `[ ⚡ Live API Mode | 🎬 Accelerated Replay (25s) ]` e contador FinOps `💰 Context Compression` funcionam no Header.
- [ ] Com o mock, o golden path roda de ponta a ponta na tela sem recarregar a página, acendendo os passos no `p-timeline` (incluindo anotação no Grafana).
- [ ] As 3 abas do quadrante central (`p-tabs`) exibem: (Aba 1) medidor `p-knob`/`p-progressbar` de **RCA Confidence Score (95%)**, tags de **Blast Radius** e árvore de spans (`p-tree`/`p-treeTable`); (Aba 2) comparativo visual **Antes vs. Depois da Sanitização de PII** com badge `Zero PII Leaked (LGPD Compliant)`; (Aba 3) Git Deploy Diff (`v2.14.7...v2.14.8`).
- [ ] O quadrante direito exibe o PR aberto no GitHub, preview do e-mail do Resend e ação de aprovação.
- [ ] O SSE reconecta sozinho depois de derrubar o mock.
- [ ] Botão **Simular Incidente em Produção** dispara `POST /api/demo/chaos` com estado `[loading]` e a tela acompanha o incidente resultante.
- [ ] Integrado ao orquestrador real, o fluxo completo funciona no `docker compose up`.
