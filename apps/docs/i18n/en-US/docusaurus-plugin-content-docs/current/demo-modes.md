---
id: demo-modes
title: Replay vs. Live Mode
slug: /demo-modes
sidebar_position: 3
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
4. _(Optional)_ Enable **Continuous Healthy Traffic** to watch baseline metrics before injecting a fault.
5. Click **Simulate Incident**: ZeroMTTR degrades the sample workload, sends controlled synthetic traffic, waits for the real Grafana alert, diagnoses the issue, opens a GitHub PR, and sends the Post-Mortem email.
6. To return the target to a healthy state at any time, open **Demo** and click **Restore Service**.

:::warning Cooldown between simulations
To prevent overlapping runs and quota abuse, the server enforces a global cooldown (default **2 minutes**) between triggers. If active, the toast notification shows the remaining seconds.
:::

:::info Targets without chaos simulation support
When connected to a real production service (or monitored passively via Prometheus), the target reports `chaosSimulation: false`. Fault-injection and synthetic-traffic buttons are automatically hidden to protect the workload.
:::
