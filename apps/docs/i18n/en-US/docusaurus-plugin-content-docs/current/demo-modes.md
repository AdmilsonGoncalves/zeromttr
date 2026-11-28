---
id: demo-modes
title: Replay vs. Live Mode
slug: /demo-modes
---

# Replay vs. Live Mode

When demo mode is enabled, clicking **Demo** in the War Room header opens a slide-over drawer supporting two execution modes.

## Quick Comparison

| Feature                    | Replay Mode (public default)                   | Live Mode (real end-to-end)                      |
| :------------------------- | :--------------------------------------------- | :----------------------------------------------- |
| **Typical duration**       | ~25 seconds                                    | ~30–60 seconds                                   |
| **External API usage**     | None (preserves LLM, GitHub, and email quotas) | Real LLM call, real GitHub PR, real email        |
| **Mutates target service** | No                                             | Yes (injects controlled degradation and traffic) |
| **Access key required**    | No                                             | Depends on server config (not required locally)  |

## Running Replay Mode

1. Click **Demo** in the War Room header.
2. Keep the **Live Mode** toggle off (`REPLAY` default).
3. Click **Simulate Incident**.
4. The drawer closes automatically so you can watch a recorded real incident stream end to end.
5. Once it reaches **Notified**, click **Simulate Approval** in the Remediation Panel to close the incident.

## Running Live Mode

1. Open the **Demo** drawer and switch **Live Mode** on.
2. If the server requires authorization for live runs, enter the **Live Demo Key** in the key field.
3. If the public deployment enables **Cloudflare Turnstile**, wait for or complete the verification widget shown below the header.
4. _(Optional)_ Enable **Continuous Healthy Traffic** to watch baseline metrics before injecting a fault. This switch is locked while the target is degraded (restore first before re-enabling) and automatically turns off when switching back to Replay Mode.
5. Click **Simulate Incident**: ZeroMTTR degrades the sample workload, sends controlled synthetic traffic, waits for the real Grafana alert, diagnoses the issue, opens a GitHub PR, and sends the Post-Mortem email.
6. To return the target to a healthy state at any time, open **Demo** and click **Restore Service**.

:::warning Simulation cooldown and back-to-back Live runs

- **Global trigger cooldown (`DEMO_COOLDOWN_MS`, default `120000` ms = 2 min):** prevents overlapping runs and quota abuse. If active, the toast notification shows the remaining seconds.
- **Repeat suppression (`REPEAT_SUPPRESSION_SECONDS`) and Grafana repeat interval (`GRAFANA_ALERT_REPEAT_INTERVAL`):** production/VPS deployments default to `900s` (15 min) with `AUTO_RESTORE_ON_APPROVE=false`. Restoring the service (and waiting ~30s for the Grafana alert to clear) only clears the target failure and allows Grafana to fire again; it does **not** end the previous incident's suppression window. To run consecutive Live simulations without waiting 15 minutes, lower **Repeat suppression** in **Settings ⚙️** **and** restore the service (or enable **Auto-restore target on approval**); otherwise, wait for the remaining window to expire. Whenever suppression or a prolonged Grafana wait occurs, the War Room displays a warning toast explaining why.
  :::

## Demo Mode Environment Variables

| Variable                                      | Purpose                                                                                  | Default                                  |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------- | :--------------------------------------- |
| `ENABLE_DEMO_MODE`                            | Shows/hides the **Demo** drawer and `/api/demo/*` endpoints                              | `true` (Compose) / `false` (strict prod) |
| `REQUIRE_DEMO_KEY`                            | Requires `X-Live-Demo-Key` header for Live Mode actions                                  | `false` local / `true` prod              |
| `LIVE_DEMO_KEY`                               | Secret key accepted in the **Live Demo Key** field                                       | —                                        |
| `PUBLIC_LIVE_DEMO`                            | Allows public Live Mode without a key when `REQUIRE_DEMO_KEY=false`                      | `false`                                  |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Enables Cloudflare Turnstile anti-bot protection on public demos                         | empty (disabled)                         |
| `DEMO_COOLDOWN_MS`                            | Minimum cooldown between `/api/demo/chaos` triggers                                      | `120000` (2 min)                         |
| `CHAOS_ENDPOINTS_ENABLED`                     | Enables `/chaos/*` endpoints on `target-app-demo`                                        | follows `ENABLE_DEMO_MODE`               |
| `CHAOS_AUTO_TRAFFIC_BURST`                    | Generates automatic synthetic traffic burst when chaos is triggered on `target-app-demo` | `true`                                   |
| `HEALTHY_TRAFFIC_AUTO_START`                  | Automatically starts continuous healthy traffic on target boot                           | `false`                                  |
| `HEALTHY_TRAFFIC_INTERVAL_MS`                 | Interval (ms) between healthy traffic waves (use `3000`–`5000` to reduce VPS load)       | `1500`                                   |

:::info Targets without chaos simulation support
When connected to a real production service (or monitored passively via Prometheus), the target reports `chaosSimulation: false`. Fault-injection and synthetic-traffic buttons are automatically hidden to protect the workload.
:::

:::note Private window or new browser
Healthy traffic is server-side state, while the mode (Live/Replay) is stored in the browser. When opening the War Room in a fresh browser (e.g., a private window) while traffic is still running, the dashboard automatically aligns the mode to **Live** — provided Live Mode is allowed (no key required, or a key is entered). If a key is required and not saved, the mode stays **Replay**, but you can still turn traffic off from the **Demo** drawer.
:::
