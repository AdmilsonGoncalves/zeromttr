# Security Policy

## 1. Security Architecture Overview

**ZeroMTTR** is designed with defense-in-depth controls for self-hosted AIOps workloads handling sensitive telemetry:

- **Strict Token Segregation:** Three independent API tokens isolate each ingress surface:
  - `MCP_AUTH_TOKEN` — authenticates callers to `apps/mcp-server` (`POST /mcp`).
  - `GRAFANA_WEBHOOK_TOKEN` — authenticates alert webhooks delivered by Grafana to `apps/orchestrator`.
  - `DASHBOARD_API_TOKEN` — injected server-side by the Nginx reverse proxy (`apps/dashboard/nginx.conf.template`) on `/api/*` requests and never shipped in frontend JavaScript bundles.
- **Email-Only HMAC Human Approval:**
  - Human-in-the-loop remediation decisions (`approve` / `reject`) are signed with HMAC-SHA256 (`DECISION_HMAC_SECRET`), bound to `incidentId`, `action`, and an expiration timestamp (`exp`), and verified with constant-time comparison (`crypto.timingSafeEqual`).
  - Signatures (`sig`) travel **exclusively** in the URL `#fragment` sent via email (`/decision/:id#action=approve&sig=...&exp=...`) so they are never sent in HTTP `GET` requests or captured in access/proxy logs, and are submitted only in the JSON body of `POST /api/incidents/:id/decision`.
  - `sig`, `approveSig`, and `rejectSig` are never exposed in REST responses, SSE streams, or application logs.
- **Dual-Barrier PII & Secret Protection (LGPD):**
  1. **Edge Redaction:** The OpenTelemetry Collector (`infra/otel-collector-config.yaml` and `infra/otel-collector-config.prod.yaml`) applies OTTL `transform` (`replace_pattern`) rules to redact PII and `Bearer`/JWT credentials before logs are persisted in Loki.
  2. **Fail-Closed Prompt Guard:** Before any payload is sent to an external LLM, `PiiPromptGuard` validates the prompt deterministically against all 5 official BACEN PIX key formats (CPF & CNPJ with Modulo-11 check digits, ANATEL mobile/landline phone rules, standard unquoted email addresses matching `[A-Za-z0-9._%+-]+@domain` — excluding quoted local-part forms — and PIX EVP UUID v4 in PIX context) and JWT/Bearer tokens. Any residual match aborts LLM dispatch immediately.
- **Secret Hygiene:**
  - Production secrets must live outside the Git repository (e.g., an external `.env` file with `chmod 600`).
  - Automated CI runs secret scanning (Gitleaks) and `pnpm audit` on Pull Requests.
  - Public demo deployments isolate Live API usage behind `LIVE_DEMO_KEY`, which should be rotated after evaluation windows.
  - Never commit real credentials or real personal data (PII) to code, tests, fixtures, or documentation.

---

## 2. Supported Versions

| Version / Branch                                  | Supported                                            |
| :------------------------------------------------ | :--------------------------------------------------- |
| `master` / `v1.x`                                 | Yes                                                  |
| `release/target-v2.14.8` (demo regression branch) | Demo scenario only (intentional pool exhaustion bug) |

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability in ZeroMTTR:

1. **Do not** open a public GitHub Issue with exploit details or exposed secrets.
2. Contact the maintainer privately via [AGJ Works](https://agjworks.com) (or use GitHub Private Vulnerability Reporting under `Security` → `Advisories` when enabled on the repository).
3. Include a clear description of the issue, affected files/endpoints, reproduction steps using synthetic data only, and any suggested remediation.

We aim to acknowledge reports within **48 hours** and coordinate a fix and disclosure timeline with the reporter.
