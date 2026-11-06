# TECH 05 — Orquestrador (Webhook + FSM + Agente) (Fase 4)

**Depende de:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md), [04](./04_partner_integrations.md)
**Objetivo:** receber o alerta do Grafana e conduzir o incidente de forma autônoma — correlacionando OTel/LGTM, inspecionando o diff do deploy no GitHub, abrindo o Pull Request cirúrgico e enviando o post-mortem com aprovação humana.

## 1. Estrutura (`apps/orchestrator/src`)
```text
domain/        incident.ts, incident-state.ts (FSM pura), rca-report.ts, fingerprint.ts, decision-hmac.ts
ports/         ReasoningPort, IncidentRepository, ToolsPort (cliente MCP para as 8 tools),
               TargetStatusPort, Clock
application/   HandleAlert, InvestigateIncident, EnrichWithDeployDiff,
               DispatchRemediation, NotifyOnCall, RecordDecision
adapters/      llm.gemini.ts, mcp.client.ts, repo.file.ts, target-status.http.ts
http/          webhook.controller.ts, api.controller.ts, decision.controller.ts, events.sse.ts, auth.ts
main.ts        composition root
```

## 2. Domínio — FSM
Estados e transições conforme mestre §5.5. Requisitos:
- `IncidentState.transition(event)` **pura** e exaustivamente testada; transição inválida lança `InvalidTransitionError`.
- Cada transição registra `timestamp` (base para MTTR) e `reason`.
- `fingerprint` do alerta (labels `alertname+service`) para **deduplicar** incidentes abertos.

## 3. Casos de uso
1. **HandleAlert:** valida payload (zod), autentica (`WEBHOOK_TOKEN`), deduplica, cria `Incident(RECEIVED)`, responde `202` imediatamente e processa em background.
2. **InvestigateIncident:** loop do agente (máx. N passos, orçamento de tokens) usando `ToolsPort`:
   `execute_promql_range` → `trace_id` do exemplar → `analyze_otel_trace` → `query_loki_logs` (filtrado por `trace_id`), além de consultar `TargetStatusPort` (`GET /chaos/status` no `target-app-demo`) para obter `version`, `previousHealthyVersion` e `lastRawUnredactedLogSample` (usado na prova visual Antes vs. Depois de PII no Dashboard). Produz `RcaReport` estruturado (resumo, span crítico, log sanitizado, `rawUnredactedLogSample`, serviço, arquivo/módulo suspeito, `trace_id`, **grau de confiança**, **tempo de diagnóstico**, **versão/deploy correlacionado** e **ações mitigatórias imediatas** sugeridas, como rollback).
   - **LLM atrás de `ReasoningPort`**; testes usam fake determinístico.
   - Fallback **determinístico** (sem LLM) que segue a sequência acima, para garantir execução mesmo se o provedor de LLM falhar.
3. **EnrichWithDeployDiff:** chama a tool MCP `inspect_git_deploy_diff` comparando `previousHealthyVersion` (`v2.14.7`) e `version` (`v2.14.8`) em `TARGET_SERVICE_PATH` (`apps/target-app-demo`), isolando o commit e o trecho de código causador da saturação do pool Knex (doc 04).
4. **DispatchRemediation:** sintetiza o patch cirúrgico via `ReasoningPort` (com fallback determinístico), injeta anotação no Grafana via tool `annotate_grafana_incident` (`REMEDIATING`), transiciona para `AWAITING_PR` e aciona a tool MCP `create_remediation_pr` (idempotente por `incident_id`), obtendo imediatamente a URL do Pull Request (`pullRequestUrl`) e o SHA do commit na branch `hotfix/zeromttr-<incident_id>`.
5. **NotifyOnCall:** gera `decisionToken: { approveSig, rejectSig, exp }` (HMAC-SHA256 com `DECISION_HMAC_SECRET`) e envia post-mortem via tool MCP `send_post_mortem_resend` com botões apontando para `${PUBLIC_DASHBOARD_URL}/decision/${id}`, **RCA Confidence Score** e **Blast Radius**. Persiste `decisionToken` no `IncidentDetail` e o emite no evento SSE `incident.notified` para que os botões do Quadrante 4 do War Room usem a mesma validação HMAC.
6. **RecordDecision:** valida HMAC + expiração (`decision-hmac.ts`), aprova/rejeita, atualiza FSM e anota no Grafana via `annotate_grafana_incident`.

### 3.1 Métricas Determinísticas de Alto Impacto (FinOps, Confidence Score, Blast Radius & Grafana Annotations)
- **RCA Confidence Score (0–100% determinístico):** calculado pelo orquestrador conforme as evidências convergem:
  - Anomalia confirmada na métrica PromQL: **+25%**
  - `trace_id` isolado via Exemplar: **+25%**
  - Span com `STATUS_CODE_ERROR` isolado no Grafana Tempo: **+25%**
  - Linha de erro correlacionada no Grafana Loki com o mesmo `trace_id` + regressão isolada no diff do deploy via GitHub (`inspect_git_deploy_diff`): **+20% (Total: 95%)**
- **Blast Radius (Raio de Explosão):** extraído do array `services_involved` retornado por `analyze_otel_trace`, listando todos os serviços impactados em cascata na árvore de spans.
- **Token Economy / FinOps:** soma `raw_bytes_fetched` e `compacted_bytes_sent_to_llm` retornados pelas tools do MCP e publica no evento SSE a taxa de compressão de contexto (ex.: `94.2%`) e a estimativa de tokens economizados (`Math.round((raw - compacted) / 4)`).
- **Auto-Injeção de Anotação no Grafana (`POST /api/annotations`):** ao isolar o RCA e abrir o PR, grava automaticamente uma anotação no Grafana com a tag `aiops-remediation`, resumo da causa raiz e link do PR, traçando a linha vertical sobre o gráfico de latência no segundo exato da ação.

### 3.2 Modo "Live API" vs. "Accelerated Replay Mode" & Proteção de Cota na VPS Pública
- O endpoint `POST /api/demo/chaos` aceita `{ "mode": "live" | "replay", "liveKey"?: string }`.
- **Cooldown Global de Simulação (`SIMULATION_COOLDOWN_MS=120000`):** se uma simulação já foi disparada nos últimos 2 minutos ou está em andamento, qualquer novo clique não cria uma segunda sessão nas APIs externas; o visitante recebe `202` e acompanha o *stream* SSE da execução atual em andamento (ou recebe o Replay acelerado).
- **Proteção da Chave Live (`LIVE_DEMO_KEY` no `.env` da VPS):** na VPS pública, o modo **`replay`** (que consulta Prometheus/Loki/Tempo locais na VPS, mas reproduz em **~25 segundos** os artefatos reais gravados do GitHub/Resend em `data/last-recorded-incident.json`) é o padrão aberto para visitantes anônimos. Para forçar uma chamada `live` real (que cria branch/PR no GitHub e envia e-mail no Resend), valida `liveKey === process.env.LIVE_DEMO_KEY` (quando `LIVE_DEMO_KEY` estiver definida). A mesma trava aplica-se a `POST /api/demo/reset` quando houver uma execução `live` em andamento, impedindo que visitantes anônimos interrompam uma execução ativa.
- **Headers Obrigatórios de Streaming SSE (`GET /api/events`):**
  ```ts
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Desativa buffering no Nginx/Traefik/Cloudflare
  ```

## 4. Persistência (MVP)
`IncidentRepository` com adapter em arquivo JSON (e `InMemory` para testes). Interface permite trocar por Postgres depois (ADR-007).

## 5. Interface HTTP
| Rota | Descrição | Auth |
| :--- | :--- | :--- |
| `POST /webhook/grafana-alert` | Recebe alertas do Grafana Alerting | Bearer `WEBHOOK_TOKEN` |
| `GET /api/incidents` / `GET /api/incidents/:id` | Estado, linha do tempo e `decisionToken` | Bearer (injetado pelo proxy do dashboard) |
| `POST /api/incidents/:id/decision` | Registra aprovar/rejeitar (usado por `/decision/:id` do e-mail e pelo Q4 do War Room) | Bearer + HMAC (`sig` + `exp`) |
| `GET /api/events` | SSE com os eventos do contrato (ver [08 §4.2](./08_dashboard_frontend.md)) | Bearer (injetado pelo proxy do dashboard) |
| `GET /api/target/status` | Estado do serviço-alvo (`healthy`/`degraded`), versão e `lastRawUnredactedLogSample` | Bearer |
| `POST /api/demo/chaos` | Liga a falha no serviço-alvo e gera carga (somente com `DEMO_MODE=true`) | Bearer (+ `liveKey` se `mode='live'` e `LIVE_DEMO_KEY` ativa) |
| `POST /api/demo/reset` | Restaura o serviço-alvo | Bearer (+ `liveKey` se houver sessão `live` ativa) |
| `GET /health` | Liveness | — |

## 6. Observabilidade e resiliência
- Logs `pino` com `incident_id`, `trace_id`, `state`.
- Timeouts por etapa; falha de etapa não crítica segue em modo degradado; falha crítica leva a `FAILED` com notificação de falha ao plantonista.
- Métrica própria: `zeromttr_incident_duration_seconds` por etapa (alimenta o KPI de MTTR).

## 7. Testes
- **Unitário:** FSM (todas as transições válidas/inválidas), `fingerprint`, montagem do `RcaReport`, `DecisionHmac`.
- **Caso de uso:** cada um com ports falsos, cobrindo caminhos de sucesso e falha de cada integração externa.
- **Integração:** webhook real → fakes HTTP das integrações (`nock`) → PR e e-mail capturados.
- **E2E (manual/CI sob demanda):** `scripts/chaos.sh` → alerta real → PR real no GitHub → e-mail real via Resend.

## 8. Critérios de aceite
- [ ] Alerta duplicado não cria segundo incidente enquanto o primeiro estiver aberto.
- [ ] RCA + abertura de PR gerados em ≤ 30 s no cenário do demo, com o fallback determinístico funcional.
- [ ] Fluxo completo chega a `NOTIFIED`; clique em "Aprovar" leva a `RESOLVED`.
- [ ] Toda transição relevante aparece como anotação no Grafana e no stream SSE.
- [ ] Cobertura ≥ 80 % em `domain/` e `application/`.
- [ ] Nenhum segredo/PII em logs, PRs e prompts.
