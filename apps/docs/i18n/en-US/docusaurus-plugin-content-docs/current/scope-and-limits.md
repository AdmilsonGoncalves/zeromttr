---
id: scope-and-limits
title: Scope, Limitations & Governance
slug: /scope-and-limits
---

# Scope, Limitations & Governance

This page transparently documents **what ZeroMTTR automates**, **what it intentionally does not do**, and the **operational boundaries of the current architecture**.

## 1. No automatic merge or production redeploy

By deliberate **Human-in-the-Loop** governance design, ZeroMTTR **never auto-merges Pull Requests and never triggers production deploys**.

| Action                                                               | Automated by ZeroMTTR?  | Who performs it                                                                |
| :------------------------------------------------------------------- | :---------------------- | :----------------------------------------------------------------------------- |
| Correlate metrics, traces, masked logs, and deploy diffs             | Yes                     | Automatic (Orchestrator + MCP Server)                                          |
| Generate root-cause analysis (RCA) and open a `hotfix/zeromttr-*` PR | Yes                     | Automatic (verified by CI when the target repository configures a CI workflow) |
| Send Post-Mortem email with signed HMAC links                        | Yes                     | Automatic                                                                      |
| Verify HMAC, close incident (`RESOLVED`), and annotate Grafana       | Yes (after human click) | On-call engineer confirms on the Decision screen                               |
| **Merge the Pull Request into the target / production branch**       | **No**                  | **Always performed manually by an engineer on GitHub**                         |
| **Trigger production build/redeploy after merge**                    | **No**                  | **Managed by the team's own release pipeline**                                 |

:::important About "Auto-Restore on Approve"
The `autoRestoreOnApprove` setting applies **only to demo environments** running workloads that expose in-memory chaos simulation. In production (or passively monitored workloads), clicking **Approve** strictly records the auditable decision, closes the incident, and annotates Grafana.
:::

## 2. Privacy (PII) protection scope and boundaries

ZeroMTTR enforces an **independent dual barrier** — edge OTTL masking (OTel Collector) plus a _fail-closed_ pre-LLM audit (`PiiPromptGuard`) — for the following structured patterns:

- **Deterministically covered:**
  - **CPF and CNPJ** (with Modulo-11 check-digit validation, formatted or unformatted);
  - **Mobile and landline phone numbers** (Brazilian ANATEL patterns);
  - **Email addresses**;
  - **Random EVP / UUID v4 keys** when accompanied by a PIX contextual label (`pix`, `pixKey`, `chave_pix`, `evp`);
  - **`Bearer` credentials and JWT tokens** (including `eyJ...` structures even without the `Bearer` prefix).
- **Outside deterministic scope:**
  - **Proper names, street addresses, or free-text sensitive notes** that lack a fixed structural format;
  - **Unformatted phone numbers or bare UUID v4 values without contextual markers** (intentionally excluded to avoid false positives on correlation IDs, trace IDs, and Unix timestamps);
  - **Non-textual payloads** (raw numeric Prometheus time series are not subjected to text scanning).

## 3. AI failure behavior (`fail-closed` and fallback)

- If `PiiPromptGuard` detects **any** residual unmasked PII pattern, dispatch to the external LLM provider is **aborted immediately** (_fail-closed_).
- Whether blocked by the privacy guard or affected by an LLM provider outage/timeout, the orchestrator completes the workflow with a **local deterministic fallback** and explicitly reports `reasoningSource: 'fallback'` in the War Room, SSE stream, and Pull Request body.
- AI patch quality depends on deploy diff clarity and collected telemetry coverage; human code review on GitHub before merging is always required.

## 4. Scale, persistence, and high availability

The current release is designed as a lean, single-node, self-hosted platform:

- **No multi-tenancy:** a single ZeroMTTR deployment serves one environment/team at a time.
- **No multi-node high availability:** the orchestrator, MCP server, and LGTM stack run as single containers via Docker Compose.
- **Lightweight persistence:**
  - **Runtime settings and audit trail:** stored in a **local SQLite database** inside the orchestrator volume;
  - **Incident history:** kept in memory with a JSON file snapshot (no dedicated long-term relational store for incidents);
  - **Metrics, logs, and traces (LGTM stack):** short-term retention tuned for active incident investigation (24-hour default in Prometheus).

## 5. Demo vs. Production separation

- On public demo deployments, anonymous visitors default to **Replay Mode** (recorded run), while real end-to-end runs (**Live Mode**) can be gated by a dedicated key, Cloudflare Turnstile, and a global simulation cooldown.
- For production-only deployments, set `ENABLE_DEMO_MODE=false` on the orchestrator: this hides the **Demo** menu in the War Room and disables all `/api/demo/*` routes completely.
