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

## 2. Domínio — FSM, `PiiPromptGuard` (Fail-Closed) e `EvidenceCoverage`
1. **FSM (`incident-state.ts`):**
   - `IncidentState.transition(event)` **pura** e exaustivamente testada; transição inválida (incluindo tentativa de segunda decisão sobre um incidente já em `RESOLVED` ou `REJECTED`) lança `InvalidTransitionError`.
   - Cada transição registra `timestamp` (base para cálculo de **TTD** e **TTPR**) e `reason`.
   - `fingerprint` do alerta (labels `alertname+service`) para **deduplicar** incidentes abertos.
2. **`PiiPromptGuard` Independente, Fail-Closed e Sem Falsos Positivos em Telemetria (`pii-prompt-guard.ts`):**
   - Segunda barreira de defesa executada antes de qualquer chamada ao `ReasoningPort`, inspecionando **exclusivamente os campos de texto livre** (`logs`, `mensagens de erro de spans`, `commits` e `diff do Git` — **nunca** os arrays de valores numéricos brutos das séries temporais do Prometheus, evitando coincidências estatísticas de módulo 11 em contadores ou durações em nanosegundos):
   - **Escopo de inspeção e integridade de tokens:** o MCP Server realiza o truncamento por política estritamente em delimitadores de linhas inteiras (`truncateLines` para logs e limites de hunks/linhas no diff, impedindo que tokens numéricos de CPF/CNPJ sejam partidos ao meio). No Orchestrator, o `PiiPromptGuard` audita individualmente cada evidência textual recebida das tools MCP e novamente o prompt unificado montado antes de qualquer chamada ao `ReasoningPort`. As regexes abaixo são literais JavaScript (`/.../`), independentes das regexes RE2 do Collector, e ficam em `pii-prompt-guard.patterns.ts`:
```js
const DDD = '(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[13-579]|8[1-9]|9[1-9])'; // DDDs válidos ANATEL
export const PII_PATTERNS = {
  cpfDotted:  /(?<![0-9a-zA-Z])\d{3}\.\d{3}\.\d{3}-\d{2}(?![0-9a-zA-Z])/,        // qualquer dígito verificador
  cnpjDotted: /(?<![0-9a-zA-Z])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![0-9a-zA-Z])/,
  digits11:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{11}(?![0-9a-zA-Z])(?!\.\d)/g,           // candidato a CPF → valida módulo 11
  digits14:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{14}(?![0-9a-zA-Z])(?!\.\d)/g,           // candidato a CNPJ → valida módulo 11
  jwt:        /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/,    // JWT cru (inclui payload curto e30)
  bearer:     /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9\-._~+/]{8,}=*/i,                // ignora o token já mascarado
  email:      /(?<![A-Za-z0-9._%+-])(?!git@[A-Za-z0-9.-]+:)[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/,
  phone:      new RegExp(String.raw`(?:\+55\s?${DDD}\s?(?:9\d{8}|[2-5]\d{7})\b|(?:\+?55\s?)?\(${DDD}\)\s?(?:9\d{4}|[2-5]\d{3})-?\d{4}\b|(?:\+?55\s?)?\b${DDD}\s?(?:9\d{4}|[2-5]\d{3})-\d{4}\b|\b(?:pix|tel|cel|fone|phone|whatsapp)\b["':=\s]+(?:\+?55)?${DDD}(?:9\d{8}|[2-5]\d{7})\b)`, 'i'),
  evpPix:     /\b(?:pix(?:_?key)?|chave_?pix|evp)\b["':=\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
};
```
   - **CPF/CNPJ:** o formato pontuado é bloqueado independentemente do dígito verificador; os candidatos `digits11`/`digits14` só contam como vazamento se passarem no cálculo oficial dos **2 dígitos verificadores (módulo 11)** e não forem sequências repetidas (`11111111111`).
   - **Regra Crítica de Implementação em JavaScript (Evitar bug do `lastIndex` em regexes globais `/g`):** Como `digits11` e `digits14` utilizam a flag `/g`, **nunca** utilizar `digits11.test(text)` diretamente em chamadas consecutivas (pois o ponteiro interno `lastIndex` não é resetado, fazendo a segunda chamada retornar `false` para o mesmo texto!). A implementação do guard deve obrigatoriamente iterar via `Array.from(text.matchAll(pattern))` ou garantir `pattern.lastIndex = 0` antes e depois da execução.
   - **Telefone (ANATEL):** celular `9XXXX-XXXX`, fixo `[2-5]XXX-XXXX`, DDD da lista oficial, com parênteses/hífen, `+55`, ou sem máscara **apenas** quando precedido por rótulo contextual (`\b(pix|tel|cel|fone|phone|whatsapp)\b`, evitando `parcel`/`excel`).
   - **E-mail:** ignora especificamente URLs SSH de repositórios Git (`git@host:...` via lookahead negativo `(?!git@[A-Za-z0-9.-]+:)`, mantendo a detecção para e-mails comuns como `git@empresa.com.br`) e o domínio `@users.noreply.github.com` (autores de commit do GitHub). Adicionalmente, a tool `inspect_git_deploy_diff` devolve apenas `login`/nome do autor e remove linhas `Co-authored-by` (ver [tech/02](./02_mcp_server.md)).
   - **EVP (chave PIX aleatória):** UUID v4 do BACEN (`4xxx-[89ab]xxx`) apenas quando precedido por rótulo PIX; `request_id`/`incident_id` comuns não disparam.
   - **Limitação documentada:** um fixo sem parênteses e sem `+55` (ex.: `12 2000-2024`) pode ser interpretado como telefone (falso positivo raro); o ensaio pré-gravação cobre o risco (`passed: true`).
    - **Cobertura de Contextos de Log & Prevenção de Falsos Positivos:**
      - As fronteiras de `digits11`/`digits14` garantem que CPFs no final de frase seguidos de ponto (`...CPF 11144477735.`), após sublinhado (`user_11144477735`) ou após hífen (`CPF-11144477735`) **sejam detectados**, enquanto `trace_id` OTel (32 hex), `span_id` (16 hex), `commit_sha` (40 hex), floats (`4512.11144477735` / `11144477735.99`) e timestamps Unix de 10/13 dígitos não acionam falso positivo.
   - **Comportamento Fail-Closed (não mascara em silêncio):**
     - Retorna `{ leakedPatternsDetected: number, detectedTypes: string[], edgeRedactedTokensVerified: number, passed: boolean }`.
     - Se `leakedPatternsDetected > 0`, o guard **NÃO** mascara silenciosamente fingindo que estava zero: ele reporta o número exato de padrões vazados que encontrou, `passed: false`, **aborta o envio ao LLM externo (fail-closed)** e aciona o `DeterministicFallbackReasoningAdapter` local (`reasoningSource: 'fallback'`).
3. **`EvidenceCoverage` Linear (`evidence-coverage.ts`):**
   - Mede de forma determinística e linear a cobertura de sinais independentes coletados durante a investigação (`0` a `4` sinais, `25%` por sinal):
     - Sinal 1 (**+25%**): Anomalia confirmada na série PromQL (`execute_promql_range`)
     - Sinal 2 (**+25%**): `trace_id` extraído via Exemplar da métrica
     - Sinal 3 (**+25%**): Span crítico com `STATUS_CODE_ERROR` isolado no Grafana Tempo (`analyze_otel_trace`)
     - Sinal 4 (**+25%**, totalizando **100% — 4/4 sinais**): Log de erro correlacionado no Loki + commit de regressão isolado no diff `v2.14.7...v2.14.8` no GitHub (`inspect_git_deploy_diff`).
   - Se algum sinal não for encontrado (ex.: diff sem commit suspeito ou métrica sem exemplar), o score cai proporcionalmente (**75% — 3/4 sinais**, **50% — 2/4 sinais**, **25% — 1/4 sinais**).

## 3. Casos de Uso (Workflow Determinístico de Coleta + Síntese por LLM)
1. **HandleAlert:** autentica exclusivamente com `GRAFANA_WEBHOOK_TOKEN`, valida payload (`zod`), deduplica por `fingerprint`, cria `Incident(RECEIVED)`, responde `202 Accepted` imediatamente e inicia o processamento assíncrono.
2. **InvestigateIncident:**
   - Executa o workflow determinístico de coleta via `ToolsPort`:
     `execute_promql_range` → `trace_id` do exemplar → `analyze_otel_trace` → `query_loki_logs` (filtrado por `trace_id`), além de consultar `TargetStatusPort` (`GET /chaos/status` no `target-app-demo`) para obter `version` (`v2.14.8`), `previousHealthyVersion` (`v2.14.7`) e `rawEdgeLogPreCollector` (amostra reportada pela aplicação antes do envio OTLP, usada apenas na comparação visual no Dashboard e **jamais** incluída no prompt do LLM).
3. **EnrichWithDeployDiff:** chama a tool MCP `inspect_git_deploy_diff` comparando as tags reais `v2.14.7` e `v2.14.8` em `apps/target-app-demo`, isolando o commit e o arquivo `apps/target-app-demo/src/repositories/payment.repository.ts` (com seu `blobSha`).
4. **DispatchRemediation:**
   - Audita o prompt montado com **`PiiPromptGuard.inspectAndEnforceFailClosed`**.
   - Se `passed === true`, sintetiza o RCA e o patch cirúrgico via `ReasoningPort` (`GeminiReasoningAdapter` configurável via `LLM_MODEL`, padrão `gemini-3.5-flash`) e registra `reasoningSource: 'llm'`. Caso o guard reprove (`fail-closed`) ou a API do LLM falhe, utiliza `DeterministicFallbackReasoningAdapter` e registra explicitamente `reasoningSource: 'fallback'`.
   - Injeta anotação no Grafana via `annotate_grafana_incident` (`REMEDIATING`), transiciona para `AWAITING_PR` e aciona `create_remediation_pr` (mirando `release/target-v2.14.8` e incluindo `reasoningSource` no corpo do PR), recebendo `branchUrl`, `pullRequestUrl` e `commitSha`.
5. **NotifyOnCall (HMAC Exclusivo no URI Fragment `#` do E-mail):**
   - Calcula `approveSig`, `rejectSig` e `exp` (timestamp Unix em segundos, TTL curto de 15 min / 900 s).
   - String canônica assinada: `canonicalMessage = `${incidentId}:${action}:${exp}`` assinada com HMAC-SHA256 (`DECISION_HMAC_SECRET`).
   - Verificação em tempo constante (`crypto.timingSafeEqual`) contra ataques de timing.
   - Envia o post-mortem via tool MCP `send_post_mortem_resend` contendo os links assinados no fragmento da URL: `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS_SEGUNDOS>`.
   - **Regra de segurança:** `approveSig` e `rejectSig` **não são salvos no `IncidentDetail` público nem emitidos no evento SSE `incident.notified`**.
6. **RecordDecision:**
   - Na rota real `POST /api/incidents/:id/decision`, exige `{ action, sig, exp }` válidos (assinados com `DECISION_HMAC_SECRET`, `exp` não expirado no relógio atual e validado via `timingSafeEqual`) e verifica que o incidente ainda está em `NOTIFIED` (rejeitando com `409 Conflict` qualquer tentativa de segunda decisão sobre incidente já `RESOLVED` ou `REJECTED`).
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
- [ ] `PiiPromptGuard` valida dígitos verificadores (módulo 11) de CPF/CNPJ e estrutura de JWT, operando em modo **fail-closed** (aborta chamada ao `GeminiReasoningAdapter` se `leakedPatternsDetected > 0`).
- [ ] `EvidenceCoverage` retorna `100% (4/4)` quando todos os 4 sinais estão presentes e degrada para `75% (3/4)` ou `50% (2/4)` quando sinais são omitidos nos testes.
- [ ] O evento SSE `incident.rca`, o `IncidentDetail` e o PR incluem `reasoningSource: 'llm' | 'fallback'`.
- [ ] Cobertura ≥ 80 % em `domain/` e `application/`.
