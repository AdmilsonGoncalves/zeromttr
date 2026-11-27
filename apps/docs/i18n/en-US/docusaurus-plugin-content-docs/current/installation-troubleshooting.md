---
id: installation-troubleshooting
title: Local Setup & Troubleshooting
slug: /installation-troubleshooting
sidebar_position: 8
---

# Local Setup & Troubleshooting

## Prerequisites

- **Node.js 24 LTS**
- **pnpm 10+**
- **Docker & Docker Compose v2.40+**

## Starting the Local Stack

```bash
# 1. Copy the environment template
cp .env.prod.template .env

# 2. Install workspace dependencies
pnpm install --frozen-lockfile

# 3. Run the full quality gate (formatting, lint, typecheck, tests, build)
pnpm run check:workspace

# 4. Start the entire stack (LGTM observability + ZeroMTTR + User Manual)
docker compose up -d --build
```

## Local Endpoints

| Service                      | URL                         |
| :--------------------------- | :-------------------------- |
| **War Room Dashboard**       | `http://localhost:4200`     |
| **User Manual (Docusaurus)** | `http://localhost:4300`     |
| **Grafana**                  | `http://localhost:3000`     |
| **Prometheus**               | `http://localhost:9090`     |
| **MCP Server**               | `http://localhost:8000/mcp` |

## Running Host CLI Scripts

Helper scripts under `scripts/` support ad-hoc terminal workflows:

- `./scripts/reset.sh` — restores the sample workload and closes temporary hotfix PRs on GitHub.
- `./scripts/chaos.sh` — triggers pool saturation and synthetic load from the CLI.
- `./scripts/record-replay.sh` — records a fresh sanitized snapshot for Replay Mode.
- `./scripts/load-test-lgtm.sh` — runs a load test and audits container RAM usage.

:::warning Running host scripts when `.env` is present
`.env.prod.template` sets `TARGET_APP_URL=http://target-app-demo:3001` for Docker-internal networking. When executing these scripts from your host machine, override the URL **inline per command**:

```bash
TARGET_APP_URL=http://127.0.0.1:3001 ./scripts/reset.sh
```

Do **not** add `export TARGET_APP_URL=http://127.0.0.1:3001` to `~/.zshrc` or `~/.bashrc`, because Docker Compose prioritizes shell variables over `.env` and would break container-to-container connectivity.
:::

## Common Troubleshooting

| Symptom                                        | Likely Cause                                                | How to Fix                                                                                |
| :--------------------------------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| **SSE Offline** in War Room header             | Orchestrator still starting or stopped.                     | Check `docker compose ps` and `docker compose logs orchestrator`.                         |
| **HTTP 403** when triggering Live Mode         | Missing/invalid `LIVE_DEMO_KEY` or expired Turnstile token. | Enter the key in the **Demo** drawer or complete Turnstile again.                         |
| **HTTP 429** when simulating an incident       | Global cooldown (2 min) or rate limit active.               | Wait the number of seconds shown in the toast notification.                               |
| **Settings in read-only mode**                 | `SETTINGS_ADMIN_TOKEN` not set in a demo environment.       | Set `SETTINGS_ADMIN_TOKEN` in `.env`, restart orchestrator, and enter it in **Settings**. |
| **Target status `Unreachable`**                | Target offline or no recent metrics in Prometheus.          | Confirm the service is healthy (`GET /health`) and exporting OTLP telemetry.              |
| **Expired link or `409 Conflict` on decision** | Link TTL expired or incident already approved/rejected.     | Each incident accepts a single final decision within its TTL (default 15 min).            |
