# TECH 02 — MCP Server and Open Interoperability (Phase 2)

**Depends on:** [01](./01_foundation_and_infrastructure.md)
**Objective:** implement the MCP server with **8 tools** in a hexagonal architecture (including OTel/LGTM correlation, inspection of the real `v2.14.7...v2.14.8` diff in the target repository, autonomous Pull Request creation, post-mortem delivery via Resend with exclusive HMAC, `annotate_grafana_incident`, and FinOps telemetry), authenticated, TDD-tested, and consumable by both the Orchestrator and external MCP clients (`.mcp.json`).

## 1. Architecture (`apps/mcp-server/src`)
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
Rule: `domain` and `application` **must not import** axios/express/MCP SDK (enforced by ESLint `no-restricted-imports`).

## 2. Tools (Contracts)
| Tool | Input (zod) | Defensive Limits & FinOps (Payload Reduction) |
| :--- | :--- | :--- |
| `execute_promql_range` | `query`, `start`, `end`, `step?` | ≤ 5 series; exemplars ≤ 10; returns FinOps payload reduction telemetry via statistical summarization (`raw_bytes_fetched`, `compacted_bytes_sent_to_llm`, `payload_reduction_percent`, `estimated_tokens_saved`) |
| `query_loki_logs` | `logql`, `start`, `end`, `limit?` | `limit` 1–100; line ≤ 500 chars; returns logs already masked by the OTel Collector (`[REDACTED_CPF]`) + policy truncation FinOps telemetry |
| `analyze_otel_trace` | `trace_id` (hex 32) | top 5 errors / top 5 slow spans; returns `services_involved` (used for *Blast Radius*) |
| `search_traces_by_traceql` | `query`, `limit?` | `limit` ≤ 20 |
| `inspect_git_deploy_diff` | `base_ref`, `head_ref`, `service_path?`, `suspect_keyword?` | Queries the GitHub API on `AdmilsonGoncalves/zeromttr` (`apps/target-app-demo`), comparing the real tags `v2.14.7...v2.14.8` and reading the suspect file + `blobSha`; ≤ 3 relevant files; ≤ 1500 chars/diff; returns FinOps telemetry.<br/>**Strict anti-PII-leak commit sanitization:** returns only the author's `login` (discarding email address) and strips `Co-authored-by: ... <email>` lines from commit message bodies, preventing false positives in `PiiPromptGuard`. |
| `create_remediation_pr` | `incident_id`, `file_path`, `patched_content`, `blob_sha?`, `title`, `rca_markdown`, `reasoning_source` | Idempotently creates/updates the `hotfix/zeromttr-<incident_id>` branch from `TARGET_BASE_BRANCH` (`release/target-v2.14.8`), applies the fix commit in `apps/target-app-demo`, and opens the Pull Request on the GitHub API (displaying `reasoning_source: 'llm' \| 'fallback'` in the PR body; never auto-merging) |
| `send_post_mortem_resend` | see [04](./04_partner_integrations.md) | Escaped HTML; HMAC-signed decision links in the **URI Fragment (`#`)**: `${PUBLIC_DASHBOARD_URL}/decision/:id#action=approve\|reject&sig=<HMAC>&exp=<TS>` |
| `annotate_grafana_incident` | `time`, `text`, `tags[]`, `pull_request_url?` | Injects a point-in-time annotation at Grafana's `POST /api/annotations` with the `aiops-remediation` tag |

> **Consolidated decision (ADR-008):** All 8 tools and their respective HTTP adapters live inside `apps/mcp-server/src/adapters/`. `apps/orchestrator` consumes all 8 tools via the MCP client (`ToolsPort`), maintaining zero adapter duplication across services.

## 3. Open MCP Contract Demonstration (`.mcp.json`)
To prove in practice that `mcp-server` is a standard, open **Model Context Protocol** server — and not merely an internal orchestrator API — the repository includes a `.mcp.json` file at the root compatible with **MCP Inspector (`npx @modelcontextprotocol/inspector`)**, **Cursor**, and **Claude Desktop**:

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
This makes it possible to demonstrate within seconds any external MCP Host listing the 8 tools (`tools/list`) and running diagnostics against Prometheus, Loki, Tempo, and GitHub.

## 4. Robustness and Security Requirements
1. **Streamable HTTP / SSE Sessions:** maintain `Map<sessionId, Transport>`; no shared global state across sessions.
2. **Auth:** `Authorization: Bearer ${MCP_AUTH_TOKEN}` middleware; `/health` open.
3. **Validation:** strict `zod` schemas per tool; errors return `isError: true` with a sanitized message.
4. **Dates:** validate ISO8601 and reject `start >= end` and windows > 24 h.
5. **Trace attributes:** check key presence with `in` (`'stringValue' in attr.value`) so boolean `false` or numeric `0` values are not discarded.
6. **Logs:** `pino` logger with `request_id`; never log API keys or tokens.

## 5. TDD Workflow (Integration Priority via `test/helpers/` + Unit Support)
1. Create reusable helpers in `apps/mcp-server/test/helpers/` (`callMcpTool(app, toolName, args, token)` and `nock` builders for Prometheus, Tempo, Loki, Grafana, GitHub, and Resend) avoiding duplicated HTTP calls.
2. Write integration tests (*Happy Paths* and *Unhappy Paths*) connecting via MCP HTTP transport (`tools/list` and `tools/call`) against the real server with `nock` intercepting outbound external APIs.
3. Write unit tests only for pure helper functions (`summarizeSeries`, `truncateLines`, `analyzeSpans`, `calculateFinOps`).
4. Implement and refactor until all tests are green.

## 6. Acceptance Criteria
- [ ] `tools/list` returns all 8 tools with valid `inputSchema` for both `orchestrator` and `@modelcontextprotocol/inspector`.
- [ ] Call without token → 401; with invalid token → 401.
- [ ] Truncation tests verify limits (500 chars/line, 100 lines, 1500 chars/diff, 5 series) and the **FinOps** calculation (`raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`).
- [ ] `annotate_grafana_incident` tool creates an annotation with tag `aiops-remediation` at `/api/annotations`.
- [ ] Two concurrent MCP sessions operate independently.
- [ ] Coverage ≥ 80% in `domain/` and `application/`.
