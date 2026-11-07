# TECH 05 — Orquestrador (Webhook Segregado + FSM + PiiPromptGuard + Agente) (Fase 4)

**Depende de:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md), [04](./04_partner_integrations.md)
**Objetivo:** receber o alerta do Grafana e conduzir o incidente até a abertura do Pull Request no repositório-alvo e envio do post-mortem via Resend — garantindo auditoria pré-LLM zero-PII (`PiiPromptGuard`), segregação de tokens e isolamento da assinatura HMAC exclusivamente no e-mail.

## 1. Estrutura (`apps/orchestrator/src`)
```text
domain/        incident.ts, incident-state.ts (FSM pura), rca-report.ts,
               evidence-coverage.ts, pii-prompt-guard.ts, fingerprint.ts, decision-hmac.ts
ports/         ReasoningPort, IncidentRepository, ToolsPort (cliente MCP para as 8 tools),
               TargetStatusPort, Clock
application/   HandleAlert, InvestigateIncident, EnrichWithDeployDiff,
               DispatchRemediation, NotifyOnCall, RecordDecision
adapters/      llm.gemini.ts, llm.fallback.ts, mcp.client.ts, repo.file.ts, target-status.http.ts
http/          webhook.controller.ts, api.controller.ts, decision.controller.ts, events.sse.ts, auth.ts
main.ts        composition root
```

## 2. Domínio — FSM, `PiiPromptGuard` e `EvidenceCoverage`
1. **FSM (`incident-state.ts`):**
   - `IncidentState.transition(event)` **pura** e exaustivamente testada; transição inválida lança `InvalidTransitionError`.
   - Cada transição registra `timestamp` (base para cálculo de **TTD** e **TTPR**) e `reason`.
   - `fingerprint` do alerta (labels `alertname+service`) para **deduplicar** incidentes abertos.
2. **`PiiPromptGuard` (`pii-prompt-guard.ts`):**
   - Função pura executada obrigatoriamente antes de qualquer chamada ao `ReasoningPort`.
   - Inspeciona o texto completo do prompt contra expressões regulares de **CPF** (`\b\d{3}\.\d{3}\.\d{3}-\d{2}\b`), **CNPJ** (`\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b`), **Bearer/JWT** (`Bearer\s+[A-Za-z0-9\-._~+/]+=*`) e chaves PIX de e-mail não mascaradas.
   - Se detectar qualquer ocorrência remanescente, aplica mascaramento defensivo imediato e registra no resultado da auditoria:
     `{ piiPatternsDetectedInPrompt: 0, redactedTokensVerified: number, passed: boolean }`.
3. **`EvidenceCoverage` (`evidence-coverage.ts`):**
   - Mede de forma determinística a cobertura de sinais independentes coletados durante a investigação (`0` a `4` sinais):
     - Sinal 1 (**+25%**): Anomalia confirmada na série PromQL (`execute_promql_range`)
     - Sinal 2 (**+25%**): `trace_id` extraído via Exemplar da métrica
     - Sinal 3 (**+25%**): Span crítico com `STATUS_CODE_ERROR` isolado no Grafana Tempo (`analyze_otel_trace`)
     - Sinal 4 (**+20%**, totalizando **95% — 4/4 sinais**; nunca exibe 100% pois diagnóstico pré-merge exige revisão humana): Log de erro correlacionado no Loki + commit de regressão isolado no diff `v2.14.7...v2.14.8` no GitHub (`inspect_git_deploy_diff`).
   - Se algum sinal não for encontrado (ex.: diff sem commit suspeito ou métrica sem exemplar), o score cai proporcionalmente (ex.: **75% — 3/4 sinais** ou **50% — 2/4 sinais**), refletindo honestamente a cobertura parcial de evidências.

## 3. Casos de Uso
1. **HandleAlert:** autentica exclusivamente com `GRAFANA_WEBHOOK_TOKEN`, valida payload (`zod`), deduplica por `fingerprint`, cria `Incident(RECEIVED)`, responde `202 Accepted` imediatamente e inicia o processamento assíncrono.
2. **InvestigateIncident:**
   - Executa o loop de investigação via `ToolsPort` (orçamento máximo de 6 chamadas de tool decididas pelo agente ou sequência canônica no `DeterministicFallbackReasoningAdapter`):
     `execute_promql_range` → `trace_id` do exemplar → `analyze_otel_trace` → `query_loki_logs` (filtrado por `trace_id`), além de consultar `TargetStatusPort` (`GET /chaos/status` no `target-app-demo`) para obter `version` (`v2.14.8`), `previousHealthyVersion` (`v2.14.7`) e `rawEdgeLogPreCollector` (usado apenas na comparação visual no Dashboard, **jamais** incluído no prompt do LLM).
3. **EnrichWithDeployDiff:** chama a tool MCP `inspect_git_deploy_diff` comparando as tags reais `v2.14.7` e `v2.14.8` em `apps/target-app-demo`, isolando o commit e o arquivo `apps/target-app-demo/src/repositories/PaymentRepository.ts` (com seu `blobSha`).
4. **DispatchRemediation:**
   - Audita as evidências com **`PiiPromptGuard.inspectAndAssertSafe`** (comprovando zero PII no prompt).
   - Sintetiza o RCA e o patch cirúrgico via `ReasoningPort` (`GeminiReasoningAdapter` configurável via `LLM_MODEL`, com fallback automático para `DeterministicFallbackReasoningAdapter` em caso de erro/timeout da API).
   - Injeta anotação no Grafana via `annotate_grafana_incident` (`REMEDIATING`), transiciona para `AWAITING_PR` e aciona `create_remediation_pr` (mirando `release/target-v2.14.8`), recebendo `branchUrl`, `pullRequestUrl` e `commitSha`.
5. **NotifyOnCall (HMAC Exclusivo no E-mail):**
   - Calcula `approveSig`, `rejectSig` e `exp` (HMAC-SHA256 com `DECISION_HMAC_SECRET`).
   - Envia o post-mortem via tool MCP `send_post_mortem_resend` contendo os links assinados `${PUBLIC_DASHBOARD_URL}/decision/${id}?action=approve|reject&sig=<HMAC>&exp=<TS>`.
   - **Regra de segurança:** `approveSig` e `rejectSig` **não são salvos no `IncidentDetail` público nem emitidos no evento SSE `incident.notified`**. O SSE publica apenas `{ incidentId, emailId, htmlPreview }` (com os links de decisão omitidos/mascarados no preview público).
6. **RecordDecision:**
   - Na rota real `POST /api/incidents/:id/decision`, exige `{ action, sig, exp }` válidos (assinados com `DECISION_HMAC_SECRET`), transiciona a FSM para `RESOLVED` ou `REJECTED` e registra anotação no Grafana.
   - Para fins de demonstração interativa na tela quando o avaliador está em modo `replay` (ou autenticado com `X-Live-Demo-Key`), expõe `POST /api/demo/simulate-decision` claramente separado do endpoint criptográfico de produção.

## 4. Modo "Live API" vs. "Accelerated Replay Mode" & Segregação de Acesso
- Na VPS pública (`https://zeromttr.agjworks.com`), visitantes anônimos sem cabeçalho `X-Live-Demo-Key` operam por padrão no modo **`replay`** (que reproduz em ~25 segundos o stream SSE real previamente gravado em `data/last-recorded-incident.json`, sem criar PRs no GitHub nem consumir cota de e-mail).
- Quando acionado localmente (`LIVE_DEMO_KEY` vazio) ou na VPS com `X-Live-Demo-Key` válida, executa o modo **`live` real de ponta a ponta**.
- **Cooldown Global (`SIMULATION_COOLDOWN_MS=120000`):** evita que cliques simultâneos abram execuções concorrentes.

## 5. Interface HTTP e Segregação de Tokens
| Rota | Descrição | Autenticação Exigida |
| :--- | :--- | :--- |
| `POST /webhook/grafana-alert` | Recebe alertas do Grafana Alerting | Bearer `GRAFANA_WEBHOOK_TOKEN` (exclusivo) |
| `GET /api/incidents` / `GET /api/incidents/:id` | Estado e linha do tempo (sem `decisionToken`) | Bearer `DASHBOARD_API_TOKEN` (injetado pelo Nginx) |
| `POST /api/incidents/:id/decision` | Efetiva decisão real vinda do link do e-mail | Assinatura HMAC válida (`sig` + `exp` não expirado) |
| `POST /api/demo/simulate-decision` | Simula decisão no War Room (rotulado como simulação) | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` se o incidente for `live` na VPS) |
| `GET /api/events` | Stream SSE (ver [08 §4.2](./08_dashboard_frontend.md)) | Bearer `DASHBOARD_API_TOKEN` (injetado pelo Nginx) |
| `GET /api/target/status` | Estado do `api-pagamentos-core` | Bearer `DASHBOARD_API_TOKEN` |
| `POST /api/demo/chaos` | Dispara simulação `live` ou `replay` | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` para `mode: 'live'` na VPS) |
| `POST /api/demo/reset` | Restaura serviço e limpa PRs de demo no repo-alvo | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` se houver sessão `live` ativa) |
| `GET /health` | Liveness check | Público |

## 6. Critérios de Aceite
- [ ] `POST /webhook/grafana-alert` rejeita requisições que usem `DASHBOARD_API_TOKEN` (401/403) e aceita apenas `GRAFANA_WEBHOOK_TOKEN`.
- [ ] `GET /api/incidents/:id` e o evento SSE `incident.notified` **não contêm** `approveSig` nem `rejectSig`.
- [ ] `PiiPromptGuard` é executado antes do `ReasoningPort` e um teste automatizado comprova que o prompt enviado ao adapter de LLM contém zero padrões de CPF, CNPJ, chave PIX de e-mail ou token Bearer/JWT.
- [ ] `EvidenceCoverage` retorna `95% (4/4)` quando todos os 4 sinais estão presentes e degrada para `75% (3/4)` ou `50% (2/4)` quando sinais são omitidos nos testes.
- [ ] Cobertura ≥ 80 % em `domain/` e `application/`.
