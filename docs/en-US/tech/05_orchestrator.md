# TECH 05 — Orchestrator (Segregated Webhook + FSM + PiiPromptGuard + Agent) (Phase 4)

**Depends on:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md), [04](./04_partner_integrations.md)
**Objective:** Receive the Grafana alert and drive the incident through opening a Pull Request in the target repository and sending the post-mortem via Resend — ensuring pre-LLM zero-PII auditing (`PiiPromptGuard`), token segregation, and isolation of the HMAC signature exclusively within the email.

## 1. Structure (`apps/orchestrator/src`)
```text
domain/        incident.ts, incident-state.ts (pure FSM), rca-report.ts,
               evidence-coverage.ts, pii-prompt-guard.ts, fingerprint.ts, decision-hmac.ts
ports/         ReasoningPort, IncidentRepository, ToolsPort (MCP client for the 8 tools),
               TargetStatusPort, Clock
application/   HandleAlert, InvestigateIncident, EnrichWithDeployDiff,
               DispatchRemediation, NotifyOnCall, RecordDecision
adapters/      llm.gemini.ts, llm.fallback.ts, mcp.client.ts, repo.file.ts, target-status.http.ts, target-status.prometheus.ts
http/          webhook.controller.ts, api.controller.ts, decision.controller.ts, events.sse.ts, auth.ts
main.ts        composition root
```

## 2. Domain — FSM, `PiiPromptGuard` (Fail-Closed), and `EvidenceCoverage`
1. **FSM (`incident-state.ts`):**
   - **Pure** and exhaustively tested `IncidentState.transition(event)`; any invalid transition (including attempting a second decision on an incident already in `RESOLVED` or `REJECTED`) throws `InvalidTransitionError`.
   - Every transition records `timestamp` (the basis for calculating **TTD** and **TTPR**) and `reason`.
   - Alert `fingerprint` (`alertname+service` labels) to **deduplicate** open incidents.
2. **Independent, Fail-Closed `PiiPromptGuard` Without Telemetry False Positives (`pii-prompt-guard.ts`):**
   - Second line of defense executed before any call to `ReasoningPort`, inspecting **exclusively free-text fields** (`logs`, `span error messages`, `commits`, and `Git diff` — **never** raw numeric value arrays from Prometheus time series, avoiding statistical modulo-11 coincidences in counters or nanosecond durations):
   - **Inspection scope and token integrity:** The MCP Server performs policy truncation strictly at whole-line boundaries (`truncateLines` for logs and hunk/line limits in the diff, preventing numeric CPF/CNPJ tokens from being split in half). In the Orchestrator, `PiiPromptGuard` individually audits each textual evidence item received from the MCP tools and again audits the unified prompt assembled before any call to `ReasoningPort`. The regexes below are JavaScript literals (`/.../`), independent of the Collector's RE2 regexes, and live in `pii-prompt-guard.patterns.ts`:
```js
const DDD = '(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[13-579]|8[1-9]|9[1-9])'; // Valid ANATEL area codes (DDD)
export const PII_PATTERNS = {
  cpfDotted:  /(?<![0-9a-zA-Z])\d{3}\.\d{3}\.\d{3}-\d{2}(?![0-9a-zA-Z])/,        // any check digit
  cnpjDotted: /(?<![0-9a-zA-Z])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![0-9a-zA-Z])/,
  digits11:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{11}(?![0-9a-zA-Z])(?!\.\d)/g,           // CPF candidate → validates modulo 11
  digits14:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{14}(?![0-9a-zA-Z])(?!\.\d)/g,           // CNPJ candidate → validates modulo 11
  jwt:        /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/,    // Raw JWT (includes short payload e30)
  bearer:     /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9\-._~+/]{8,}=*/i,                // ignores already-redacted token
  email:      /(?<![A-Za-z0-9._%+-])(?!git@[A-Za-z0-9.-]+:(?:[A-Za-z0-9._~-]+\/[A-Za-z0-9._~/-]+|[A-Za-z0-9._~/-]+\.git(?![A-Za-z0-9._~/-])))[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/,
  phone:      new RegExp(String.raw`(?:\+55\s?${DDD}\s?(?:9\d{8}|[2-5]\d{7})\b|(?:\+?55\s?)?\(${DDD}\)\s?(?:9\d{4}|[2-5]\d{3})-?\d{4}\b|(?:\+?55\s?)?\b${DDD}\s?(?:9\d{4}|[2-5]\d{3})-\d{4}\b|\b(?:pix|tel|cel|fone|phone|whatsapp)\b["':=\s]+(?:\+?55)?${DDD}(?:9\d{8}|[2-5]\d{7})\b)`, 'i'),
  evpPix:     /\b(?:pix(?:_?key)?|chave_?pix|evp)\b["':=\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
};
```
   - **CPF/CNPJ:** The dotted format is blocked regardless of check digits; `digits11`/`digits14` candidates only count as a leak if they pass the official **2-check-digit (modulo 11)** calculation and are not repeated-digit sequences (`11111111111`).
   - **Critical JavaScript Implementation Rule (Avoid `lastIndex` bug on global `/g` regexes):** Because `digits11` and `digits14` use the `/g` flag, **never** call `digits11.test(text)` directly across consecutive invocations (since the internal `lastIndex` pointer is not reset, causing the second call to return `false` for the same text!). The guard implementation must iterate via `Array.from(text.matchAll(pattern))` or ensure `pattern.lastIndex = 0` before and after execution.
   - **Phone (ANATEL):** Mobile `9XXXX-XXXX`, landline `[2-5]XXX-XXXX`, area code (DDD) from the official list, with parentheses/hyphen, `+55`, or unmasked **only** when preceded by a contextual label (`\b(pix|tel|cel|fone|phone|whatsapp)\b`, avoiding `parcel`/`excel`).
   - **Email:** Specifically ignores Git repository SSH URLs (`git@host:owner/repo` or `git@host:repo.git` via negative lookahead, while preserving detection for regular emails even when followed by a colon such as `git@empresa.com.br: error`) and the `@users.noreply.github.com` domain (GitHub commit authors). Additionally, the `inspect_git_deploy_diff` tool returns only the author's `login`/name and strips `Co-authored-by` lines (see [tech/02](./02_mcp_server.md)).
   - **EVP (random PIX key):** BACEN UUID v4 (`4xxx-[89ab]xxx`) only when preceded by a PIX label; ordinary `request_id`/`incident_id` values do not trigger.
   - **Documented limitation:** A landline without parentheses and without `+55` (e.g., `12 2000-2024`) may be interpreted as a phone number (rare false positive); the pre-recording rehearsal covers this risk (`passed: true`).
    - **Log Context Coverage & False-Positive Prevention:**
      - The `digits11`/`digits14` boundaries ensure that CPFs at the end of a sentence followed by a period (`...CPF 11144477735.`), after an underscore (`user_11144477735`), or after a hyphen (`CPF-11144477735`) **are detected**, whereas OTel `trace_id` (32 hex), `span_id` (16 hex), `commit_sha` (40 hex), floats (`4512.11144477735` / `11144477735.99`), and 10/13-digit Unix timestamps do not trigger false positives.
   - **Fail-Closed Behavior (does not silently mask):**
     - Returns `{ leakedPatternsDetected: number, detectedTypes: string[], edgeRedactedTokensVerified: number, passed: boolean }`.
     - If `leakedPatternsDetected > 0`, the guard **DOES NOT** silently mask and pretend it was zero: it reports the exact number of leaked patterns found, `passed: false`, **aborts sending to the external LLM (fail-closed)**, and triggers the local `DeterministicFallbackReasoningAdapter` (`reasoningSource: 'fallback'`).
3. **Linear `EvidenceCoverage` (`evidence-coverage.ts`):**
   - Deterministically and linearly measures the coverage of independent signals collected during the investigation (`0` to `4` signals, `25%` per signal):
     - Signal 1 (**+25%**): Anomaly confirmed in the PromQL series (`execute_promql_range`)
     - Signal 2 (**+25%**): `trace_id` extracted via metric Exemplar
     - Signal 3 (**+25%**): Critical span with `STATUS_CODE_ERROR` isolated in Grafana Tempo (`analyze_otel_trace`)
     - Signal 4 (**+25%**, totaling **100% — 4/4 signals**): Correlated error log in Loki + regression commit isolated in the `v2.14.7...v2.14.8` diff on GitHub (`inspect_git_deploy_diff`).
   - If any signal is not found (e.g., diff without a suspect commit or metric without an exemplar), the score drops proportionally (**75% — 3/4 signals**, **50% — 2/4 signals**, **25% — 1/4 signals**).

## 3. Use Cases (Deterministic Collection Workflow + LLM Synthesis)
1. **HandleAlert:** Authenticates exclusively with `GRAFANA_WEBHOOK_TOKEN`, validates payload (`zod`), deduplicates by `fingerprint`, creates `Incident(RECEIVED)`, responds `202 Accepted` immediately, and starts asynchronous processing.
2. **InvestigateIncident:**
   - Executes the deterministic collection workflow via `ToolsPort`:
     `execute_promql_range` → `trace_id` from exemplar → `analyze_otel_trace` → `query_loki_logs` (filtered by `trace_id`), in addition to querying `TargetStatusPort` (selected via `TARGET_STATUS_PROVIDER=manifest|prometheus`: `HttpTargetStatusAdapter` polling `TARGET_STATUS_PATH:-/ops/status` with `404` fallback to `/chaos/status`, or `PrometheusTargetStatusAdapter` querying Prometheus via MCP `ToolsPort`) to obtain `version`, `previousHealthyVersion`, `capabilities`, and optional `rawEdgeLogPreCollector` (sample reported by the application before OTLP export, used only for visual comparison in the Dashboard and **never** included in the LLM prompt).
3. **EnrichWithDeployDiff:** Calls the MCP tool `inspect_git_deploy_diff` comparing the real tags `v2.14.7` and `v2.14.8` in `apps/target-app-demo`, isolating the commit and the file `apps/target-app-demo/src/repositories/payment.repository.ts` (with its `blobSha`).
4. **DispatchRemediation:**
   - Audits the assembled prompt with **`PiiPromptGuard.inspectAndEnforceFailClosed`**.
   - If `passed === true`, synthesizes the RCA and surgical patch via `ReasoningPort` (`GeminiReasoningAdapter` configurable via `LLM_MODEL`, default `gemini-3.5-flash`) and records `reasoningSource: 'llm'`. If the guard rejects (`fail-closed`) or the LLM API fails, uses `DeterministicFallbackReasoningAdapter` and explicitly records `reasoningSource: 'fallback'`.
   - Injects a Grafana annotation via `annotate_grafana_incident` (`REMEDIATING`), triggers `create_remediation_pr` (targeting `release/target-v2.14.8` and including `reasoningSource` in the PR body), receives `branchUrl`, `pullRequestUrl`, and `commitSha`, and only then transitions to `AWAITING_PR`.
5. **NotifyOnCall (HMAC Exclusively in the Email URI `#` Fragment):**
   - Computes `approveSig`, `rejectSig`, and `exp` (Unix timestamp in seconds, short TTL of 15 min / 900 s).
   - Signed canonical string: `canonicalMessage = `${incidentId}:${action}:${exp}`` signed with HMAC-SHA256 (`DECISION_HMAC_SECRET`).
   - Constant-time verification (`crypto.timingSafeEqual`) against timing attacks.
   - Sends the post-mortem via the MCP tool `send_post_mortem_resend` containing the signed links in the URL fragment: `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS_SECONDS>`.
   - **Security rule:** `approveSig` and `rejectSig` **are never saved in the public `IncidentDetail` nor emitted in the `incident.notified` SSE event**.
6. **RecordDecision & Decoupled Post-Approval Hook:**
   - On the real route `POST /api/incidents/:id/decision`, requires valid `{ action, sig, exp }` (signed with `DECISION_HMAC_SECRET`, `exp` not expired on the current clock, and validated via `timingSafeEqual`) and verifies that the incident is still in `NOTIFIED` (rejecting with `409 Conflict` any attempt at a second decision on an incident already in `RESOLVED` or `REJECTED`).
   - `RecordDecision` stays strictly agnostic of `DemoControlPort`, exposing only an optional `onIncidentApproved(incident)` callback wired in `main.ts` by the `demo/` layer (`createDemoSessionLifecycle`) when `ENABLE_DEMO_MODE !== 'false'` so live email approval resets the demo target consistently with `POST /api/demo/simulate-decision`.
   - In `demo.controller.ts`, `POST /api/demo/chaos` (live mode) and `POST /api/demo/healthy-traffic` guard against targets declaring `capabilities.chaosSimulation === false` or `capabilities.healthyTrafficToggle === false` (`400 CAPABILITY_NOT_SUPPORTED`).
   - For interactive on-screen demonstration purposes when the evaluator is in `replay` mode (or authenticated with `X-Live-Demo-Key`), exposes `POST /api/demo/simulate-decision`, clearly separated from the production cryptographic endpoint.

## 4. "Live API" Mode vs. "Accelerated Replay Mode" & Access Segregation
- Set `ENABLE_DEMO_MODE=false` for real/production usage (omits `/api/demo/*` routes and hides the War Room `app-main-menu` simulation controls).
- On the public VPS (`https://zeromttr.agjworks.com`) with `ENABLE_DEMO_MODE=true`, anonymous visitors without an `X-Live-Demo-Key` header operate by default in **`replay`** mode (which replays in ~25 seconds the real SSE stream previously recorded in `data/last-recorded-incident.json`, without creating GitHub PRs or consuming email quota), unless `REQUIRE_DEMO_KEY=false` (or legacy `PUBLIC_LIVE_DEMO=true`) is enabled (recommended with Cloudflare Turnstile verification).
- When triggered locally (empty `LIVE_DEMO_KEY`), with `REQUIRE_DEMO_KEY=false` (or `PUBLIC_LIVE_DEMO=true`) + Turnstile, or on the VPS with a valid `X-Live-Demo-Key`, executes true end-to-end **`live` mode**.
- **Global Cooldown (`DEMO_COOLDOWN_MS=120000`):** Prevents simultaneous clicks from opening concurrent runs.

## 5. HTTP Interface and Token Segregation
| Route | Description | Required Authentication |
| :--- | :--- | :--- |
| `POST /webhook/grafana-alert` | Receives Grafana Alerting webhooks | Bearer `GRAFANA_WEBHOOK_TOKEN` (exclusive) |
| `GET /api/incidents` / `GET /api/incidents/:id` | State and timeline (without `decisionToken`) | Bearer `DASHBOARD_API_TOKEN` (injected by Nginx) |
| `POST /api/incidents/:id/decision` | Executes real decision from the email link | Valid HMAC signature (`sig` + unexpired `exp`) |
| `POST /api/demo/simulate-decision` | Simulates decision in the War Room (labeled as simulation) | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` if incident is `live` on VPS) |
| `GET /api/events` | SSE stream (see [08 §4.2](./08_dashboard_frontend.md)) | Bearer `DASHBOARD_API_TOKEN` (injected by Nginx) |
| `GET /api/target/status` | Target workload state & capabilities | Bearer `DASHBOARD_API_TOKEN` |
| `GET /api/demo/config` | Runtime demo/menu flags (`demoModeEnabled`, `requireDemoKey`, Turnstile) | Bearer `DASHBOARD_API_TOKEN` |
| `POST /api/demo/chaos` | Triggers `live` or `replay` simulation | Bearer `DASHBOARD_API_TOKEN` (+ Turnstile when configured; `X-Live-Demo-Key` for `mode: 'live'` when `REQUIRE_DEMO_KEY=true`) |
| `POST /api/demo/reset` | Restores service and cleans up demo PRs in target repo | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` if an active `live` session exists) |
| `GET /health` | Liveness check | Public |

## 6. Acceptance Criteria
- [ ] `POST /webhook/grafana-alert` rejects requests using `DASHBOARD_API_TOKEN` (401/403) and accepts only `GRAFANA_WEBHOOK_TOKEN`.
- [ ] `GET /api/incidents/:id` and the `incident.notified` SSE event **do not contain** `approveSig` or `rejectSig`.
- [ ] `PiiPromptGuard` validates CPF/CNPJ check digits (modulo 11) and JWT structure, operating in **fail-closed** mode (aborts call to `GeminiReasoningAdapter` if `leakedPatternsDetected > 0`).
- [ ] `EvidenceCoverage` returns `100% (4/4)` when all 4 signals are present and degrades to `75% (3/4)` or `50% (2/4)` when signals are omitted in tests.
- [ ] The `incident.rca` SSE event, `IncidentDetail`, and the PR include `reasoningSource: 'llm' | 'fallback'`.
- [ ] Coverage ≥ 80% in `domain/` and `application/`.
