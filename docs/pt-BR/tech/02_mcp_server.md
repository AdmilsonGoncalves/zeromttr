# TECH 02 — Servidor MCP e Interoperabilidade Aberta (Fase 2)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** implementar o servidor MCP com **8 tools** em arquitetura hexagonal (incluindo correlação OTel/LGTM, inspeção do diff real `v2.14.7...v2.14.8` no repositório-alvo, abertura de Pull Request autônomo, envio de post-mortem via Resend com HMAC exclusivo, `annotate_grafana_incident` e telemetria FinOps), autenticado, testado em TDD e consumível tanto pelo Orchestrator quanto por clientes MCP externos (`.mcp.json`).

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
Regra: `domain` e `application` **não importam** axios/express/SDK MCP (validado por ESLint `no-restricted-imports`).

## 2. Tools (Contratos)
| Tool | Entrada (zod) | Limites Defensivos & FinOps |
| :--- | :--- | :--- |
| `execute_promql_range` | `query`, `start`, `end`, `step?` | ≤ 5 séries; exemplars ≤ 10; retorna telemetria FinOps (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`, `compression_ratio_percent`, `estimated_tokens_saved`) |
| `query_loki_logs` | `logql`, `start`, `end`, `limit?` | `limit` 1–100; linha ≤ 500 chars; retorna logs já mascarados pelo OTel Collector (`[REDACTED_CPF]`) + telemetria FinOps |
| `analyze_otel_trace` | `trace_id` (hex 32) | top 5 erros / top 5 lentos; retorna `services_involved` (usado para o *Blast Radius*) |
| `search_traces_by_traceql` | `query`, `limit?` | `limit` ≤ 20 |
| `inspect_git_deploy_diff` | `base_ref`, `head_ref`, `service_path?`, `suspect_keyword?` | Consulta a API do GitHub sobre `AdmilsonGoncalves/zeromttr` (`apps/target-app-demo`) comparando as tags reais `v2.14.7...v2.14.8` e lendo o arquivo suspeito + `blobSha`; ≤ 3 arquivos relevantes; ≤ 1500 chars/diff; retorna telemetria FinOps |
| `create_remediation_pr` | `incident_id`, `file_path`, `patched_content`, `blob_sha?`, `title`, `rca_markdown` | Cria/atualiza de forma idempotente a branch `hotfix/zeromttr-<incident_id>` a partir de `TARGET_BASE_BRANCH` (`release/target-v2.14.8`), aplica o commit cirúrgico em `apps/target-app-demo` e abre o Pull Request na API do GitHub (sem nunca fazer merge automático) |
| `send_post_mortem_resend` | ver [04](./04_partner_integrations.md) | HTML escapado; links de decisão assinados via HMAC apontando para `${PUBLIC_DASHBOARD_URL}/decision/:id?action=approve|reject&sig=<HMAC>&exp=<TS>` |
| `annotate_grafana_incident` | `time`, `text`, `tags[]`, `pull_request_url?` | Injeta anotação pontual em `POST /api/annotations` do Grafana com a tag `aiops-remediation` |

> **Decisão consolidada (ADR-008):** Todas as 8 tools e seus respectivos adapters HTTP vivem dentro de `apps/mcp-server/src/adapters/`. O `apps/orchestrator` consome todas as 8 tools via cliente MCP (`ToolsPort`), mantendo zero duplicação de adapters entre serviços.

## 3. Demonstração de Contrato MCP Aberto (`.mcp.json`)
Para comprovar na prática que o `mcp-server` é um servidor **Model Context Protocol** padrão e aberto — e não apenas uma API interna do orquestrador — o repositório inclui na raiz o arquivo `.mcp.json` compatível com **MCP Inspector (`npx @modelcontextprotocol/inspector`)**, **Cursor** e **Claude Desktop**:

```json
{
  "mcpServers": {
    "zeromttr-aiops": {
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```
Isso permite demonstrar em poucos segundos qualquer Host MCP externo listando as 8 tools (`tools/list`) e executando diagnósticos sobre o Prometheus, Loki, Tempo e GitHub.

## 4. Requisitos de Robustez e Segurança
1. **Sessões Streamable HTTP / SSE:** manter `Map<sessionId, Transport>`; sem estado global compartilhado entre sessões.
2. **Auth:** middleware `Authorization: Bearer ${MCP_AUTH_TOKEN}`; `/health` aberto.
3. **Validação:** schemas `zod` estritos por tool; erros retornam `isError: true` com mensagem sanitizada.
4. **Datas:** validar ISO8601 e rejeitar `start >= end` e janelas > 24 h.
5. **Atributos de trace:** checar presença de chave com `in` (`'stringValue' in attr.value`) para não descartar valores booleanos `false` ou numéricos `0`.
6. **Logs:** logger `pino` com `request_id`; nunca registrar chaves de API ou tokens.

## 5. Fluxo TDD (Por Tool)
1. Escrever teste unitário do domínio (`summarizeSeries`, `truncateLines`, `analyzeSpans`, `calculateFinOps`).
2. Escrever teste do caso de uso com port falso.
3. Escrever contract test do adapter com `nock` (respostas capturadas em `test/fixtures/`).
4. Implementar; refatorar.
5. Teste de integração: cliente oficial `@modelcontextprotocol/sdk` conectando via HTTP → `tools/list` e `tools/call`.

## 6. Critérios de Aceite
- [ ] `tools/list` retorna as 8 tools com `inputSchema` válido tanto para o `orchestrator` quanto para o `@modelcontextprotocol/inspector`.
- [ ] Chamada sem token → 401; com token inválido → 401.
- [ ] Testes de truncamento comprovam os limites (500 chars/linha, 100 linhas, 1500 chars/diff, 5 séries) e o cálculo de **FinOps** (`raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`).
- [ ] Tool `annotate_grafana_incident` cria anotação com tag `aiops-remediation` em `/api/annotations`.
- [ ] Duas sessões MCP simultâneas funcionam de forma independente.
- [ ] Cobertura ≥ 80 % em `domain/` e `application/`.
