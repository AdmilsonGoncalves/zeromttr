# TECH 02 — Servidor MCP e Interoperabilidad Abierta (Fase 2)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** implementar el servidor MCP con **8 herramientas** en una arquitectura hexagonal (incluyendo correlación OTel/LGTM, inspección del diff real `v2.14.7...v2.14.8` en el repositorio objetivo, creación autónoma de Pull Requests, entrega de post-mortem mediante Resend con HMAC exclusivo, `annotate_grafana_incident` y telemetría FinOps), autenticado, probado mediante TDD y consumible tanto por el Orquestador como por clientes MCP externos (`.mcp.json`).

## 1. Arquitectura (`apps/mcp-server/src`)
```text
domain/        summarize-series.ts, truncate.ts, span-analysis.ts, finops.ts   (pure functions)
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
Regla: `domain` y `application` **no deben importar** axios/express/MCP SDK (impuesto mediante ESLint `no-restricted-imports`).

## 2. Herramientas (Contratos)
| Herramienta | Entrada (zod) | Límites Defensivos y FinOps (Reducción de Payload) |
| :--- | :--- | :--- |
| `execute_promql_range` | `query`, `start`, `end`, `step?` | ≤ 5 series; ejemplares ≤ 10; devuelve telemetría FinOps de reducción de payload mediante resumen estadístico (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`, `payload_reduction_percent`, `estimated_tokens_saved`) |
| `query_loki_logs` | `logql`, `start`, `end`, `limit?` | `limit` 1–100; línea ≤ 500 caracteres; devuelve logs ya enmascarados por el OTel Collector (`[REDACTED_CPF]`) + telemetría FinOps de truncado por política |
| `analyze_otel_trace` | `trace_id` (hex 32) | top 5 errores / top 5 spans lentos; devuelve `services_involved` (usado para *Blast Radius*) |
| `search_traces_by_traceql` | `query`, `limit?` | `limit` ≤ 20 |
| `inspect_git_deploy_diff` | `base_ref`, `head_ref`, `service_path?`, `suspect_keyword?` | Consulta la API de GitHub en `AdmilsonGoncalves/zeromttr` (`apps/target-app-demo`), comparando las etiquetas reales `v2.14.7...v2.14.8` y leyendo el archivo sospechoso + `blobSha`; ≤ 3 archivos relevantes; ≤ 1500 caracteres/diff; devuelve telemetría FinOps.<br/>**Sanitización estricta de commits anti-fugas de PII:** devuelve únicamente el `login` del autor (descartando la dirección de correo electrónico) y elimina las líneas `Co-authored-by: ... <email>` del cuerpo de los mensajes de commit, evitando falsos positivos en `PiiPromptGuard`. |
| `create_remediation_pr` | `incident_id`, `file_path`, `patched_content`, `blob_sha?`, `title`, `rca_markdown`, `reasoning_source` | Crea/actualiza de forma idempotente la rama `hotfix/zeromttr-<incident_id>` desde `TARGET_BASE_BRANCH` (`release/target-v2.14.8`), aplica el commit de corrección en `apps/target-app-demo` y abre el Pull Request en la API de GitHub (mostrando `reasoning_source: 'llm' \| 'fallback'` en el cuerpo del PR; nunca realiza fusión automática) |
| `send_post_mortem_resend` | véase [04](./04_partner_integrations.md) | HTML escapado; enlaces de decisión firmados con HMAC en el **Fragmento de URI (`#`)**: `${PUBLIC_DASHBOARD_URL}/decision/:id#action=approve\|reject&sig=<HMAC>&exp=<TS>` |
| `annotate_grafana_incident` | `time`, `text`, `tags[]`, `pull_request_url?` | Inyecta una anotación puntual en `POST /api/annotations` de Grafana con la etiqueta `aiops-remediation` |

> **Decisión consolidada (ADR-008):** Todas las 8 herramientas y sus respectivos adaptadores HTTP residen dentro de `apps/mcp-server/src/adapters/`. `apps/orchestrator` consume las 8 herramientas mediante el cliente MCP (`ToolsPort`), manteniendo cero duplicación de adaptadores entre servicios.

## 3. Demostración de Contrato MCP Abierto (`.mcp.json`)
Para demostrar en la práctica que `mcp-server` es un servidor estándar y abierto del **Model Context Protocol** —y no simplemente una API interna del orquestador—, el repositorio incluye un archivo `.mcp.json` en la raíz compatible con **MCP Inspector (`npx @modelcontextprotocol/inspector`)**, **Cursor** y **Claude Desktop**:

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
Esto permite demostrar en cuestión de segundos cómo cualquier Host MCP externo lista las 8 herramientas (`tools/list`) y ejecuta diagnósticos contra Prometheus, Loki, Tempo y GitHub.

## 4. Requisitos de Robustez y Seguridad
1. **Sesiones Streamable HTTP / SSE:** mantener `Map<sessionId, Transport>`; sin estado global compartido entre sesiones.
2. **Autenticación:** middleware `Authorization: Bearer ${MCP_AUTH_TOKEN}`; `/health` abierto.
3. **Validación:** esquemas `zod` estrictos por herramienta; los errores devuelven `isError: true` con un mensaje sanitizado.
4. **Fechas:** validar ISO8601 y rechazar `start >= end` y ventanas > 24 h.
5. **Atributos de traza:** comprobar la presencia de claves con `in` (`'stringValue' in attr.value`) para que los valores booleanos `false` o numéricos `0` no se descarten.
6. **Logs:** logger `pino` con `request_id`; nunca registrar claves de API ni tokens.

## 5. Flujo de Trabajo TDD (Prioridad de Integración mediante `test/helpers/` + Soporte Unitario)
1. Crear helpers reutilizables en `apps/mcp-server/test/helpers/` (`callMcpTool(app, toolName, args, token)` y constructores `nock` para Prometheus, Tempo, Loki, Grafana, GitHub y Resend) evitando llamadas HTTP duplicadas.
2. Escribir tests de integración (*Happy Paths* y *Unhappy Paths*) conectando mediante transporte HTTP MCP (`tools/list` y `tools/call`) contra el servidor real con `nock` interceptando las APIs externas salientes.
3. Escribir tests unitarios únicamente para funciones auxiliares puras (`summarizeSeries`, `truncateLines`, `analyzeSpans`, `calculateFinOps`).
4. Implementar y refactorizar hasta que todos los tests estén en verde.

## 6. Criterios de Aceptación
- [ ] `tools/list` devuelve las 8 herramientas con `inputSchema` válido tanto para `orchestrator` como para `@modelcontextprotocol/inspector`.
- [ ] Llamada sin token → 401; con token inválido → 401.
- [ ] Los tests de truncado verifican los límites (500 caracteres/línea, 100 líneas, 1500 caracteres/diff, 5 series) y el cálculo **FinOps** (`raw_bytes_fetched` frente a `compacted_bytes_sent_to_llm`).
- [ ] La herramienta `annotate_grafana_incident` crea una anotación con la etiqueta `aiops-remediation` en `/api/annotations`.
- [ ] Dos sesiones MCP concurrentes operan de forma independiente.
- [ ] Cobertura ≥ 80 % en `domain/` y `application/`.
