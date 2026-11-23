# TECH 04 — External Integrations: GitHub REST API (Target Repo) and Resend (Exclusive HMAC)

**Depends on:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md) · **Consumed by:** [05](./05_orchestrator.md)
**Objective:** implement fast, idempotent, port-isolated HTTP adapters for real diff inspection between releases (`RepoInspectorPort`), autonomous Pull Request creation in the target repository (`RemediationPort`), and notification with exclusive HMAC email links (`NotifierPort`).

## 1. Ports (`apps/mcp-server/src/ports/`)
```ts
interface RepoInspectorPort {
  inspectDeployDiff(req: DeployDiffRequest): Promise<DeployDiffBundle>;
}

interface RemediationPort {
  createPullRequest(req: RemediationPrRequest): Promise<RemediationPrReceipt>;
}

interface NotifierPort {
  sendPostMortem(r: PostMortem): Promise<NotificationReceipt>;
}
```
Where `RemediationPrReceipt` returns `{ branchName: string; branchUrl: string; pullRequestUrl: string; commitSha: string }`.

## 2. GitHub Deploy & Code Inspector (`RepoInspectorPort` — `inspect_git_deploy_diff`)
- **Objective:** compare the real tags `v2.14.7` (healthy) and `v2.14.8` (degraded) in the `TARGET_GITHUB_REPO` repository (`https://github.com/AdmilsonGoncalves/zeromttr`, folder `apps/target-app-demo`) and retrieve the content and `sha` of the suspect file (`apps/target-app-demo/src/repositories/payment.repository.ts`).
- **GitHub API Behavior:**
  1. Queries `GET /repos/{owner}/{repo}/compare/{base_ref}...{head_ref}` (`v2.14.7...v2.14.8`).
  2. Filters modified files inside `service_path` (`apps/target-app-demo`) and extracts the change author's commit, commit message, and *patch* (truncated to ≤ 1500 chars per file).
  3. Queries `GET /repos/{owner}/{repo}/contents/{filePath}?ref={head_ref}` to obtain the full Base64-encoded content and the **current blob `sha`** (required for the remediation step).
  4. Calculates **FinOps** telemetry (`raw_bytes_fetched` from the raw GitHub API payload vs. `compacted_bytes_sent_to_llm` after filtering only relevant hunks).

## 3. GitHub Autonomous PR Remediation (`RemediationPort` — `create_remediation_pr`)
- **Objective:** open a real, testable, and deterministic Pull Request in **2 to 5 seconds** on the `AdmilsonGoncalves/zeromttr` repository (targeting `TARGET_BASE_BRANCH`, default `release/target-v2.14.8`) using `GITHUB_TOKEN`.
- **GitHub API Flow:**
  1. Fetches the tip SHA of the base branch (`release/target-v2.14.8`) via `GET /repos/{owner}/{repo}/git/ref/heads/{baseBranch}`.
  2. Creates (or reuses, ensuring **idempotency by `incident_id`**) the branch `refs/heads/hotfix/zeromttr-<incident_id>` (`POST /repos/{owner}/{repo}/git/refs`).
  3. Fetches the file's current blob `sha` on the branch (`GET /repos/{owner}/{repo}/contents/{filePath}?ref=hotfix/zeromttr-<incident_id>`) and writes the fixed file (`PUT /repos/{owner}/{repo}/contents/{filePath}` passing Base64 `content`, blob `sha`, and `branch`) with a structured commit message (`fix(target-app-demo): release db client in finally block and restore pool size [incident <id>]`).
  4. Opens the Pull Request (`POST /repos/{owner}/{repo}/pulls` with `base: 'release/target-v2.14.8'`) containing title, RCA summary, OTel evidence table, `v2.14.7...v2.14.8` regression diff, zero-PII audit, and governance checklist; **never performs an automatic merge**.
- **Automated CI Validation:** opening the PR triggers `.github/workflows/hotfix-verify.yml`, which runs the `@zeromttr/target-app-demo` regression test and comments the `✅ ZeroMTTR Autonomous CI Gate: PASSED` badge on the PR.

## 4. Resend (`NotifierPort` — `send_post_mortem_resend`) with Exclusive HMAC in URI Fragment (`#`)
- HTML template as a pure function (`renderPostMortem`), with **HTML escaping** on all dynamic fields, displaying:
  - **Evidence Coverage Score** (`4/4 Signals — 100%`),
  - **Reasoning Source** (`llm` vs. `fallback`),
  - **Blast Radius** (`services_involved`),
  - **Pre-LLM Audit (`PiiPromptGuard`)** (`leakedPatternsDetected: 0`),
  - Regression-causing commit (`v2.14.7...v2.14.8`),
  - Button to review the Pull Request on GitHub (`AdmilsonGoncalves/zeromttr`),
  - Human decision buttons (**Approve Hotfix** / **Reject Hotfix**) containing HMAC-SHA256-signed links in the **URI Fragment (`#`)** with a short TTL (15 min):
    `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS>`.
- **Why Use URI Fragment (`#`) Instead of Query String (`?`) and Resend Domain Configuration:**
  - Browsers **never send the `#fragment` portion of a URL in HTTP GET requests** to the server; therefore, the `sig` signature **never appears in Cloudflare, Traefik, or Nginx access logs**.
  - The Angular SPA `/decision/:id` route reads `window.location.hash` locally in the browser and sends `{ action, sig, exp }` exclusively in the `POST /api/incidents/:id/decision` request body.
  - **Preserving `#fragment` in Resend:** keep **Click Tracking disabled** in the `zeromttr.agjworks.com` domain settings in the Resend dashboard to ensure the `https://zeromttr.agjworks.com/decision/:id#action=...` link reaches the email client without intermediary URL rewriting.
- **HMAC Signature Security Isolation:**
  - The `approveSig` and `rejectSig` signatures are sent **exclusively inside the email delivered by Resend** to the `ON_CALL_ENGINEER_EMAIL` recipient.
  - They are **never** returned in `GET /api/incidents/:id` nor emitted on the SSE stream (`incident.notified`).
- Idempotency via `Idempotency-Key: post-mortem-<incident_id>` header on the Resend API call.

## 5. Tests (TDD — Integration via `test/helpers/` + Pure Support Functions)
| Target | Type | Scenarios (Happy & Unhappy Paths using `test/helpers/`) |
| :--- | :--- | :--- |
| `formatPrDescription` & `renderPostMortem` | unit (pure support) | Happy: includes RCA, metrics, `trace_id`, Evidence Coverage, Blast Radius, and `#fragment` links; Unhappy: escapes `<script>` (XSS) and enforces limits |
| `verifyDecisionHmac` | unit (pure support) | Happy: valid signature within 15 min TTL; Unhappy: tampered signature, mismatched `incidentId`, or expired `exp` |
| `inspect_git_deploy_diff` (`GithubInspectorHttpAdapter`) | HTTP integration (`callMcpTool` + `nock`) | Happy: succeeds comparing `v2.14.7...v2.14.8`, extracts `blobSha`, truncates ≤ 1500 chars, and computes FinOps; Unhappy: nonexistent tag / 404 or 500 error from GitHub API |
| `create_remediation_pr` (`GithubRemediationHttpAdapter`) | HTTP integration (`callMcpTool` + `nock`) | Happy: creates branch + commit with `sha` + PR and idempotency when branch/PR already exists; Unhappy: 409/422 conflict or 5xx failure |
| `send_post_mortem_resend` (`ResendHttpAdapter`) | HTTP integration (`callMcpTool` + `nock`) | Happy: succeeds with `Idempotency-Key` header and `#fragment` links; Unhappy: 4xx/5xx error from Resend API |

## 6. Acceptance Criteria
- [ ] No automated test calls real external APIs.
- [ ] Manual smoke test (`scripts/smoke-integrations.sh`) validates real call to `LLM_MODEL` (`gemini-3.5-flash`), `inspect_git_deploy_diff`, `create_remediation_pr` on `AdmilsonGoncalves/zeromttr`, and email delivery on Resend.
- [ ] Email arrives with working HMAC links, while the `incident.notified` SSE payload does not expose `sig`.
