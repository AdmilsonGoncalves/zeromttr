# TECH 07 — Live Demo, TTD/TTPR Measurement, and Final Delivery (Phases 5–6)

**Depends on:** [05](./05_orchestrator.md), [08](./08_dashboard_frontend.md)
**Objective:** Consolidate the system into a 3-minute live demonstration (real `Live` mode + external MCP client), document the timed baseline for **TTD** and **TTPR**, and freeze the production environment for evaluation.

## 1. Video Demonstration Script (3 Minutes — Real `Live` Mode)
Because anonymous visitors on the public URL see `Replay` mode by default (for quota protection), **the demonstration video must record real end-to-end `Live` mode**, in addition to demonstrating the open MCP contract in an external client:

| Time | Step | Live Evidence Demonstrated |
| :--- | :--- | :--- |
| **0:00 – 0:25** | Operational Problem & Open Architecture | Contextualization in the **Logistics & Automation** track (workflow automation and cross-system integration): edge PII masking differentiator + token FinOps + open MCP contract agnostic to the monitored service. |
| **0:25 – 0:45** | Open MCP Contract (External Client) | **MCP Inspector** (or Cursor/Claude Desktop via `.mcp.json`) connected directly to `zeromttr-mcp-server`, listing the 8 tools (`tools/list`) and invoking `execute_promql_range`. |
| **0:45 – 1:10** | Real Incident Trigger (`⚡ Live API Mode`) | Click "Simulate Incident" in the War Room; `api-pagamentos-core` enters `degraded` (`v2.14.8`); Grafana fires an alert to the Orchestrator. |
| **1:10 – 1:40** | Edge OTTL Masking & OTel Collection (`TTD ≤ 15s`) | Tab 1 shows `Evidence Coverage: 4/4 Signals (100%)` + `reasoningSource: 'llm'` + `Blast Radius` + failing `pg.pool.acquire` span; Tab 2 shows the log reported in the application (pre-Collector) vs. the log masked by OTTL `transform` (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `Bearer [REDACTED_TOKEN]`) and the fail-closed audit from `PiiPromptGuard` (`leakedPatternsDetected: 0`). |
| **1:40 – 2:10** | Real Diff `v2.14.7...v2.14.8` & Autonomous PR (`TTPR ≤ 30s`) | Tab 3 shows the diff extracted from `apps/target-app-demo/src/repositories/payment.repository.ts` and the dynamically calculated FinOps reduction (`bytes reduced / estimated tokens saved`). Clicking the link opens on GitHub the **newly created real Pull Request** (against `release/target-v2.14.8`) with `reasoningSource: llm` and the comment `✅ ZeroMTTR Autonomous CI Gate: PASSED` posted by `hotfix-verify.yml`. |
| **2:10 – 2:40** | Post-Mortem in Resend & Human Approval via HMAC (`#fragment`) | Display of the real email received via **Resend** (`sre@send.zeromttr.agjworks.com`); clicking the **Approve Hotfix** button in the email opens `/decision/:id#action=approve&sig=...`, confirms via `POST` with HMAC signature, and transitions state to `RESOLVED` + annotation on the Grafana chart. |
| **2:40 – 3:00** | Closing with Timed Metrics | Comparison between the timed manual baseline (7 steps) and the TTD/TTPR measured by `scripts/measure-mttr.sh`. |

## 2. Honest Measurement of TTD and TTPR vs. Timed Manual Baseline
The `scripts/measure-mttr.sh` script reads the transition timestamps from `GET /api/incidents/:id` and computes:
1. **TTD (*Time to Deterministic Diagnosis*):** `timestamp(REMEDIATING) - timestamp(RECEIVED)` (target: ≤ 15 s).
2. **TTPR (*Time to Reviewable Pull Request*):** `timestamp(AWAITING_PR/NOTIFIED) - timestamp(RECEIVED)` (target: ≤ 30 s).
3. **Time to Post-Mortem Delivered:** `timestamp(NOTIFIED) - timestamp(RECEIVED)` (target: ≤ 45 s).

For a fair comparison in the README, time and record a real manual execution of the same 7 steps performed by an engineer (1. read alert; 2. run PromQL; 3. open exemplar in Tempo; 4. filter Loki by `trace_id`; 5. run `git diff v2.14.7...v2.14.8 -- apps/target-app-demo`; 6. edit `payment.repository.ts` and run tests; 7. create branch and open PR).

## 3. Mandatory Documentation in the Public Repository
- `README.md` (en-US) and `README.pt-BR.md`:
  - Explicit statement of the **Logistics & Automation** track (operational workflow automation and cross-system integrations) and domain-agnostic architecture.
  - Qualified comparison table (HolmesGPT / OpenSRE / Bits AI vs. ZeroMTTR, referenced as of Nov/2026).
  - **"Technical Transparency and MVP Limits"** section:
    1. Explanation of **`Live` Mode vs. `Replay` Mode** on the public demo (`https://zeromttr.agjworks.com`) and how to test in `Live` mode (locally via Docker Compose or with the `LIVE_DEMO_KEY`, which must be rotated after evaluation).
    2. Clarification that the autonomous cycle ends at the **CI-verified Pull Request + signed human decision** (without automatic merge/redeploy on the running container).
    3. Clarification that the FinOps metric measures **payload reduction via summarization and policy truncation** (using `bytes / 4` estimation), and that PII masking covers the **5 official Central Bank PIX Key types** (CPF and CNPJ via Federal Revenue Modulo-11, Mobile/Landline Phone via ANATEL rules, RFC 5322 Email, and Random Key EVP / RFC 4122 UUID v4 in PIX context) plus JWT/Bearer tokens (while technical UUIDs such as `request_id` and proper names in free text are not blocked).
  - How to connect an external MCP client using the root `.mcp.json` file.
  - Explanation of tags `v2.14.7` (healthy on `master`) and `v2.14.8` (regression on `release/target-v2.14.8`) for deterministic Pull Request reproduction.
- `docs/en-US/adr/` with ADRs 001–009.
- `CONTRIBUTING.md` and `SECURITY.md`.

## 4. Pre-Recording Rehearsal, Delivery, and Production Stability Checklist
- [ ] `docker compose up` works on a clean machine (local development).
- [ ] Tags `v2.14.7` and `v2.14.8` and branch `release/target-v2.14.8` created **after** `.github/workflows/hotfix-verify.yml` and `apps/target-app-demo` tests exist, with **Branch Protection on `master`** and **Tag Protection on `v2.14.*`** active on GitHub **including administrators (*"Do not allow bypassing"* / empty *Bypass list*)** and tested by attempting a direct `git push` to `master` with the VPS PAT (confirming rejection).
- [ ] **Pre-Recording Rehearsal (Live Rehearsal):**
  - Confirm in the SSE event and PR that `PiiPromptGuard` returned `passed: true, leakedPatternsDetected: 0` and that `reasoningSource === 'llm'` (`gemini-3.5-flash`).
  - Confirm on the Pull Request opened against `release/target-v2.14.8` that the `hotfix-verify.yml` workflow triggered and posted `✅ ZeroMTTR Autonomous CI Gate: PASSED`.
  - Confirm in the real email received via Resend (with *Click Tracking* disabled on the domain) that the `/decision/:id#action=approve&sig=...&exp=...` link preserves the `#` fragment and completes the transition to `RESOLVED`.
  - Re-record the `data/last-recorded-incident.json` snapshot from this final `live` execution (already containing `reasoningSource: 'llm'` and `Evidence Coverage: 100%`).
- [ ] Video up to 3 minutes recorded in `Live` mode with English (`en-US`) narration or subtitles.
- [ ] On the VPS, secrets stored exclusively in a file outside the Git repository (e.g., `/path/to/secrets/.env` with `600` permissions) containing the 3 segregated tokens (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`) and dedicated `LIVE_DEMO_KEY` (to be rotated after evaluation).
- [ ] Stack load-tested on the VPS consuming ≤ 2.2 GB RAM, with zero OOMKill on Prometheus/Loki/Tempo and zero telemetry ports exposed on the host (`ss -tulpn`).
- [ ] Release `v1.0.0` published and **VPS deployment frozen** (no automatic deploys on ad-hoc pushes) to guarantee 100% availability throughout the evaluation period.
- [ ] 3-minute video recorded in real `Live` mode and published in the README.
