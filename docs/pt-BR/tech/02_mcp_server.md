# TECH 02 — Servidor MCP (Fase 2)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** servidor MCP com **8 tools** (incluindo correlação OTel/LGTM, inspeção de diff de deploy no GitHub, abertura de PR autônomo, envio de post-mortem via Resend, `annotate_grafana_incident`, telemetria FinOps, verificação de PII e *Blast Radius*), arquitetura hexagonal, autenticado e totalmente testado.

## 1. Arquitetura (`apps/mcp-server/src`)
```text
domain/        summarize-series.ts, truncate.ts, span-analysis.ts, finops.ts   (funções puras)
ports/         MetricsPort, LogsPort, TracesPort, RepoInspectorPort, RemediationPort, NotifierPort, AnnotationPort
application/   ExecutePromqlRange, QueryLokiLogs, AnalyzeOtelTrace,
               SearchTracesByTraceQL, InspectGitDeployDiff,
               CreateRemediationPr, SendPostMortemResend, AnnotateGrafanaIncident
adapters/      prometheus.http.ts, loki.http.ts, tempo.http.ts,
               github-inspector.http.ts, github-remediation.http.ts,
               resend.http.ts, grafana-annotations.http.ts
transport/     mcp-server.ts, tool-registry.ts, auth.ts
config/        env.ts (zod)
main.ts        composition root
```
Regra: `domain` e `application` **não importam** axios/express/SDK MCP.

## 2. Tools (contratos)
| Tool | Entrada (zod) | Limites defensivos & FinOps |
| :--- | :--- | :--- |
| `execute_promql_range` | `query`, `start`, `end`, `step?` | ≤ 5 séries; exemplars ≤ 10; retorna telemetria FinOps (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`, `compression_ratio_percent`, `estimated_tokens_saved`) |
| `query_loki_logs` | `logql`, `start`, `end`, `limit?` | `limit` 1–100; linha ≤ 500 chars; retorna telemetria FinOps (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`, `compression_ratio_percent`, `estimated_tokens_saved`) |
| `analyze_otel_trace` | `trace_id` (hex 32) | top 5 erros / top 5 lentos; retorna `services_involved` (usado para o *Blast Radius*) |
| `search_traces_by_traceql` | `query`, `limit?` | `limit` ≤ 20 |
| `inspect_git_deploy_diff` | `base_ref`, `head_ref`, `service_path`, `suspect_keyword?` | Consulta a API do GitHub (`compareCommits` + conteúdo de arquivo suspeito); ≤ 3 arquivos relevantes; ≤ 1500 chars/diff; retorna telemetria FinOps (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`) |
| `create_remediation_pr` | `incident_id`, `file_path`, `patched_content`, `title`, `rca_markdown` (ver [04](./04_partner_integrations.md)) | Cria/atualiza de forma idempotente a branch `hotfix/zeromttr-<incident_id>`, aplica o commit cirúrgico e abre o Pull Request na API do GitHub (sem nunca fazer merge automático) |
| `send_post_mortem_resend` | ver [04](./04_partner_integrations.md) | HTML escapado; links de decisão apontando para `${PUBLIC_DASHBOARD_URL}/decision/:id` |
| `annotate_grafana_incident` | `time`, `text`, `tags[]`, `pull_request_url?` | Injeta anotação pontual em `POST /api/annotations` do Grafana com a tag `aiops-remediation` (autentica via `Bearer ${GRAFANA_SA_TOKEN}` com papel Editor, ou fallback para Basic Auth `GRAFANA_ADMIN_USER:GRAFANA_ADMIN_PASSWORD` se `GRAFANA_SA_TOKEN` estiver vazio no demo local) |

> **Decisão consolidada (ADR-008 e ADR-009):** Todas as 8 tools e seus respectivos adapters HTTP vivem dentro de `apps/mcp-server/src/adapters/` (os contratos de GitHub e Resend são detalhados no doc [04](./04_partner_integrations.md)). O `apps/orchestrator` consome todas as 8 tools via cliente MCP (`ToolsPort`), mantendo zero duplicação de adapters entre serviços.

## 3. Requisitos de robustez e segurança
1. **Sessões SSE/Streamable HTTP:** manter `Map<sessionId, Transport>`; remover estado global único.
2. **Body parser:** não aplicar `express.json()` nas rotas do transporte que leem stream bruto, ou repassar `req.body` como 3º argumento de `handlePostMessage`.
3. **Transporte:** preferir **Streamable HTTP**; manter SSE como compatibilidade.
4. **Auth:** middleware `Authorization: Bearer ${MCP_AUTH_TOKEN}`; `/health` aberto.
5. **Validação:** schemas `zod` estritos por tool; erros retornam `isError: true` com mensagem sanitizada.
6. **Dependências:** alinhar `express` e `@types/express` na mesma major; usar `@types/node@^24`; remover dependências não utilizadas.
7. **Datas:** validar ISO8601 e rejeitar `start >= end` e janelas > 24 h.
8. **Atributos de trace:** checar presença de chave com `in` (`'stringValue' in attr.value`) para não perder `false` ou `0`.
9. **Logs:** logger `pino` com `request_id`; nunca logar chaves de API.

## 4. Fluxo TDD (por tool)
1. Escrever teste unitário do domínio (ex.: `summarizeSeries` com séries vazias, uma série, deltas com divisor zero).
2. Escrever teste do caso de uso com port falso.
3. Escrever contract test do adapter com `nock` (respostas reais capturadas em `test/fixtures/`).
4. Implementar; refatorar.
5. Teste de integração: cliente MCP (`@modelcontextprotocol/sdk` client) → `tools/list` e `tools/call`.

## 5. Critérios de aceite
- [ ] `tools/list` retorna as 8 tools com `inputSchema` válido.
- [ ] Chamada sem token → 401; com token inválido → 401.
- [ ] Testes de truncamento comprovam os limites (500 chars/linha, 100 linhas, 1500 chars/diff, 5 séries) e o cálculo de **Token Economy / FinOps** (`raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`).
- [ ] Tool/adapter `annotate_grafana_incident` cria anotação com tag `aiops-remediation` em `/api/annotations`.
- [ ] Duas sessões simultâneas funcionam.
- [ ] Cobertura ≥ 80 % em `domain/` e `application/`.
- [ ] Contra o compose real, `execute_promql_range` retorna resumo e (com o demo app) `trace_id` de exemplar.
