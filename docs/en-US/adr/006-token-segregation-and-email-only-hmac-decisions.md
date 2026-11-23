# ADR-006: API Token Segregation and Email-Only HMAC Human Approval

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

ZeroMTTR exposes multiple entry points (MCP server, Grafana alert webhook, Dashboard API/SSE, and human decision endpoint). Sharing a single secret across surfaces or exposing approval tokens in the frontend would violate the principle of least privilege and allow anonymous demo visitors to approve or reject real hotfixes.

## Decision

1. **Strictly segregate three independent tokens:**
   - `MCP_AUTH_TOKEN`: authentication between clients/orchestrator and `apps/mcp-server`.
   - `GRAFANA_WEBHOOK_TOKEN`: authentication for the alert webhook triggered by Grafana.
   - `DASHBOARD_API_TOKEN`: injected server-side by the Nginx reverse proxy (`apps/dashboard/nginx.conf.template`) into `/api/*` calls, never embedded in the JavaScript bundle.
2. **Sign human decisions with HMAC-SHA256** (`DECISION_HMAC_SECRET`) with expiration (`exp`) and binding to `incidentId` and `action` (`approve` | `reject`), using constant-time comparison (`crypto.timingSafeEqual`).
3. **Transport the signature exclusively in the URL `#fragment`** sent via email through Resend (`/decision/:id#action=approve&sig=...&exp=...`). The `#fragment` is never sent to the server on `GET` requests or written to access logs; `DecisionComponent` reads the fragment in the browser and sends `action`, `sig`, and `exp` in the body of `POST /api/incidents/:id/decision`.
4. **Never expose** `sig`, `approveSig`, or `rejectSig` in REST responses, SSE events, or structured logs. `POST /api/demo/simulate-decision` is strictly demo-only (not a production human approval path), gated by `DASHBOARD_API_TOKEN`, and for `live` incidents additionally requires `X-Live-Demo-Key` when `LIVE_DEMO_KEY` is set (an empty `LIVE_DEMO_KEY` skips this check).

## Consequences

### Positive

- Anonymous visitors can follow the War Room in real time without any ability to forge human approval.
- Compromise of one integration token does not grant access to the other surfaces.

### Trade-offs

- Requires the email provider (Resend) to keep *Click Tracking* disabled on the sending domain so the URL `#fragment` is preserved intact.

## Rejected Alternatives

- **Passing `sig` in a query string (`?sig=...`):** would leak the signature in HTTP proxy logs, browser history, and `Referer` headers.
- **Including a direct approval button in the War Room without email signature:** would break *human-in-the-loop* governance in public environments.

## Code References

- `apps/orchestrator/src/domain/decision-hmac.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/orchestrator/src/http/decision.controller.ts`
- `apps/mcp-server/src/transport/auth.ts`
- `apps/dashboard/nginx.conf.template`
