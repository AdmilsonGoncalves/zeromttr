# TECH 06 — Testing Strategy (Integration & E2E First), Helpers, and Quality (Cross-Cutting)

**Applies to:** all phases · **Reference:** Master Architecture §6 and §10

## 1. Testing Philosophy: *Testing Trophy* (Integration and E2E Priority)
Because **ZeroMTTR** is an event-driven platform integrating multiple systems (Grafana Alerting → Orchestrator HTTP/SSE → MCP Server HTTP → OTel Collector/LGTM → GitHub/Resend/Gemini), the project adopts the **Testing Trophy** model:
1. **Top Priority — Integration and E2E Tests (`test/integration/` and `scripts/smoke-*.sh`):**
   - Exercise the real application flow from the HTTP edge (`Supertest`), passing through routing, authentication, state machine (FSM), `PiiPromptGuard`, MCP communication over HTTP, and SSE serialization, intercepting only external APIs at the outbound HTTP boundary (`nock`).
   - Must cover **both *Happy Paths* and *Unhappy Paths*** before implementation (integration TDD), serving as executable system documentation.
2. **Unit Tests Only for Pure Support Functions (`test/unit/`):**
   - Reserved **strictly** for pure algorithms without I/O: Modulo-11 check digit calculation (CPF/CNPJ), regular expression validators (ANATEL / BACEN EVP / JWT), linear `EvidenceCoverage` calculation, FinOps byte truncation/pruning, pure FSM transitions, and HTML escaping (`renderPostMortem`).
   - Avoids creating dozens of unit tests coupled to artificial mocks for flows that are already validated far more faithfully by integration tests.

---

## 2. Folder Structure and Mandatory Test Helpers (`test/helpers/`)
To avoid repeating HTTP commands (`supertest(app).post(...).set('Authorization', ...)`), payload assembly, or repetitive `nock` configuration, each package **must implement reusable helper functions in `test/helpers/` before writing test suites**:

```text
apps/<package>/test/
  helpers/
    http-test-client.ts     # Helper functions encapsulating Supertest calls and auth headers
    external-apis.helper.ts # Reusable nock builders for LGTM, GitHub, Gemini, and Resend
    fixtures.helper.ts      # Payload factories (Grafana alerts, logs with/without PII, Git diffs)
  integration/              # Top priority: complete HTTP, MCP, SSE, and PII flows (Happy & Unhappy)
  unit/                     # Pure support functions only (Modulo-11, ANATEL/BACEN regexes, FinOps, FSM)
```

### Minimum Contract for Helpers (`test/helpers/http-test-client.ts` & `external-apis.helper.ts`)
- **`postGrafanaAlert(app, overrides?, token = GRAFANA_WEBHOOK_TOKEN)`:** Fires `POST /webhook/grafana-alert` with a `Bearer` header and valid default payload (allowing field overrides or invalid token testing in 1 line).
- **`getIncident(app, incidentId, token = DASHBOARD_API_TOKEN)`:** Executes `GET /api/incidents/:id` with Dashboard authentication.
- **`postEmailHmacDecision(app, incidentId, { action, sig, exp })`:** Executes `POST /api/incidents/:id/decision` simulating submission of the `#` fragment read by the SPA.
- **`callMcpTool(app, toolName, args, token = MCP_AUTH_TOKEN)`:** Wraps the JSON-RPC `tools/call` envelope over `POST /mcp`.
- **`collectSseEventsUntil(app, predicateOrState, timeoutMs)`:** Connects to `GET /api/events` and collects emitted SSE events until the target state is reached (e.g., `NOTIFIED` or `RESOLVED`).
- **`stubObservabilityAndGithub({ lokiLogBody, traceStatus, gitDiffPatch, geminiShouldFail })`:** Configures in a single call all HTTP interceptors (`nock`) for Prometheus, Tempo, Loki, GitHub, Gemini, and Resend, allowing any *Happy Path* or *Unhappy Path* to be tested by swapping only the desired parameter.

---

## 3. Test-Driven Development Rules (Integration TDD + Support)
1. **Write *Happy Paths* and *Unhappy Paths* first (Red → Green → Refactor):** Before implementing a route, MCP tool, or PII protection rule, write the success and failure scenarios using the helpers in `test/helpers/`.
2. **Parameterized tests (`it.each` / `test.each`):** For validation rules and regexes (CPF, CNPJ, ANATEL, BACEN EVP, JWT), use parameterized tables containing valid (*Happy*) and invalid/adversarial (*Unhappy*) inputs side by side, serving as living documentation.
3. **Forbidden to call real external APIs in the automated suite (`ci.yml`):** All communication with Gemini, GitHub, Resend, and LGTM in Vitest integration tests goes through the helpers in `external-apis.helper.ts` (`nock`). Real testing against Docker containers and external APIs happens in the smoke/E2E scripts (`scripts/smoke-integrations.sh`).

---

## 4. Mandatory Matrix of *Happy Paths* vs. *Unhappy Paths* (Executable Documentation)

### 4.1 Integration and Support: Dual PII Barrier (5 BACEN PIX Key Types + ANATEL + JWT)
Tested **both in the integration pipeline** (injecting the log via `stubObservabilityAndGithub({ lokiLogBody })` and verifying the behavior of Orchestrator + `PiiPromptGuard` + Gemini call or block) **and in the parameterized table (`it.each`) of the support function**:

| Rule / Pattern | 🟢 Happy Path (Clean Telemetry / Post-Collector → `passed: true`, calls Gemini, `reasoningSource: 'llm'`) | 🔴 Unhappy Path (Residual Leak / Pre-Collector → `passed: false`, **0 Gemini calls [Fail-Closed]**, `reasoningSource: 'fallback'`) |
| :--- | :--- | :--- |
| **1. CPF (Federal Revenue Modulo-11)** | • Already masked log `[REDACTED_CPF]`<br/>• 32-hex OTel `trace_id` (`4bf92f3577b34da6a3ce929d0e0e4736`)<br/>• 40-hex `commit_sha`<br/>• Decimal float (`4512.11144477735` and `11144477735.99`)<br/>• 11-digit sequence with invalid Modulo-11 (`12345678900`) or repeated digits (`11111111111`)<br/>• **State idempotency:** running the guard twice in a row on the same text produces the exact same result (`passed: true`), proving absence of the `/g` regex `lastIndex` bug | • Dotted CPF (`123.456.789-00` / `111.444.777-35`)<br/>• Isolated unpunctuated CPF (`cpf=11144477735`)<br/>• **CPF at end of sentence followed by a period (`...falhou para CPF 11144477735.`)**<br/>• **CPF after underscore (`user_11144477735`) or hyphen (`CPF-11144477735`)**<br/>• **Double call:** two consecutive invocations containing an invalid/leaked CPF result in `passed: false` on both |
| **2. CNPJ (Federal Revenue Modulo-11)** | • Already masked log `[REDACTED_CNPJ]`<br/>• 14-digit sequence with invalid Modulo-11 or repeated digits (`11111111111111`) | • Dotted CNPJ (`12.345.678/0001-99` / `11.222.333/0001-81`)<br/>• Unpunctuated CNPJ valid under Modulo-11 (`11222333000181`), including at the end of a sentence with a period |
| **3. Mobile and Landline Phone (ANATEL Rules)** | • Already masked log `[REDACTED_PHONE]`<br/>• **10-digit (`1734567890`) and 13-digit (`1734567890123`) Unix timestamps**<br/>• 8-digit number starting with `6` (`(11) 6456-7890` — invalid for landline per ANATEL) | • **9-digit mobile (`9XXXX-XXXX`):** `(11) 98765-4321`, `11 98765-4321`<br/>• **8-digit landline (`[2-5]XXX-XXXX`):** `(11) 3456-7890`, `11 3456-7890`<br/>• **International E.164 PIX (`+55`):** `+5511987654321`, `+551134567890`<br/>• **Unmasked in contextual field:** `pix=11987654321`, `"phone":"11987654321"`, `tel: 1134567890` |
| **4. PIX Email Key (RFC 5322)** | • Already masked log `[REDACTED_PIX_EMAIL]`<br/>• Package names `@modelcontextprotocol/sdk` (no valid TLD domain after `@`) | • Plaintext email in log or span error (`cliente.silva@exemplo.com.br`) |
| **5. Random PIX Key (EVP / BACEN UUID v4)** | • Already masked log `pixKey=[REDACTED_PIX_EVP]`<br/>• **Ordinary technical UUID v4 without PIX label (`request_id=123e4567-e89b-42d3-a456-426614174000`, `incident_id=...`)**<br/>• UUID v1 (3rd block not starting with `4`) | • RFC 4122 UUID v4 (`4xxx-[89ab]xxx`) preceded by PIX context: `pixKey=123e4567-e89b-42d3-a456-426614174000`, `"chave_pix": "123e4567-e89b-42d3-a456-426614174000"`, `evp: 123e4567-...` |
| **6. Bearer Credentials & JWT** | • Already masked log `Bearer [REDACTED_TOKEN]` | • `Bearer <token>` header<br/>• **Raw JWT without the word `Bearer`**, both long and with **short payload (`eyJhbGciOiJIUzI1NiJ9.e30.sig`)** |

---

### 4.2 HTTP Integration: Incident Flow, MCP, FinOps, and HMAC Governance
Tested via `Supertest` using the helpers in `test/helpers/http-test-client.ts`:

| Integrated Flow | 🟢 Happy Path | 🔴 Unhappy Path |
| :--- | :--- | :--- |
| **1. Alert Ingestion (`POST /webhook/grafana-alert`)** | • Valid `GRAFANA_WEBHOOK_TOKEN` → `202 Accepted`, creates incident and starts async pipeline<br/>• Second alert with same `fingerprint` while open → deduplicates and returns existing incident | • Missing token or using `DASHBOARD_API_TOKEN` / `MCP_AUTH_TOKEN` → `401 Unauthorized`<br/>• Malformed payload (missing `alerts` or `service`) → `400 Bad Request` (Zod) |
| **2. MCP Collection & `EvidenceCoverage` (`POST /mcp`)** | • 4 signals present (PromQL + Exemplar `trace_id` + Error span in Tempo + Loki log & GitHub `v2.14.7...v2.14.8` diff) → `EvidenceCoverage = 100% (4/4)`, pruned payload (≤ 5 series, ≤ 100 lines, ≤ 1500 diff chars), and `finops` calculated | • MCP call without `MCP_AUTH_TOKEN` → `401`<br/>• Partial signal absence (e.g., metric without exemplar or diff without suspect commit) → linear degradation to `75% (3/4)` or `50% (2/4)` without aborting diagnosis<br/>• Total Gemini API unavailability → deterministic fallback (`reasoningSource: 'fallback'`) |
| **3. HMAC Isolation & Human Decision (`POST /api/incidents/:id/decision`)** | • Email link uses fragment `#action=approve&sig=<HMAC>&exp=<TS>`<br/>• `POST /api/incidents/:id/decision` with valid `sig` and `exp` within 15 min → `200 OK`, transitions FSM to `RESOLVED` (or `REJECTED`), and annotates Grafana | • `GET /api/incidents/:id` and `incident.notified` SSE stream **never expose `sig` (`approveSig`/`rejectSig`)**<br/>• Tampered `sig` signature or from another `incidentId` → `401 Unauthorized`<br/>• Expired `exp` timestamp (> 15 min) → `401 Unauthorized`<br/>• **Second decision attempt on an incident already `RESOLVED` or `REJECTED` → `409 Conflict` (`InvalidTransitionError`)** |
| **4. XSS Escaping in Post-Mortem (`renderPostMortem`)** | • Generated HTML contains Evidence Coverage, Reasoning Source, Blast Radius, and `#fragment` links | • `<script>alert(1)</script>` injection in RCA summary or service name is escaped (`&lt;script&gt;`) |

---

## 5. Quality Gates in GitHub Actions CI/CD
| Check | Criterion | Workflow |
| :--- | :--- | :--- |
| Integration Suite (Happy + Unhappy Paths) + Support Functions | 100% passing + Coverage ≥ 80% in `domain/` and `application/` (blocking) | `ci.yml` |
| ESLint (including hexagonal boundary) + Prettier | 0 errors (blocking) | `ci.yml` |
| `tsc --noEmit` | 0 errors (blocking) | `ci.yml` |
| Leaked secrets (`gitleaks`) | 0 occurrences (blocking) | `ci.yml` |
| Dependency audit (`pnpm audit --prod --audit-level=critical`) | 0 `critical` vulnerabilities (blocking) | `ci.yml` |
| Regression suite on autonomous PRs (`hotfix/zeromttr-*`) | 100% green + PR comment | `hotfix-verify.yml` |
| Image Build & Push (`ghcr.io`) | Success across all 4 services | `cd-release.yml` |

## 6. Definition of Done (Per Phase / Pull Request)
- [ ] Test helpers (`test/helpers/`) created without HTTP code duplication
- [ ] Integration tests (*Happy Paths* + *Unhappy Paths*) and support function tests written first and passing
- [ ] `pnpm run check:workspace` 100% green
- [ ] Zero secrets, zero PII, and zero references to unversioned external artifacts
- [ ] Acceptance criteria of the corresponding `tech/NN` document met
