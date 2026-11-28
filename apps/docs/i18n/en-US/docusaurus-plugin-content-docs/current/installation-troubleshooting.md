---
id: installation-troubleshooting
title: Local Setup & Troubleshooting
slug: /installation-troubleshooting
---

# Local Setup & Troubleshooting

## Prerequisites

- **Node.js 24 LTS**
- **pnpm 12+**
- **Docker & Docker Compose v2.40+**

## Starting the Local Stack

```bash
# 1. Copy the environment template
cp .env.prod.template .env

# 2. (Optional for Replay Mode; required for Live Mode)
# Edit .env to select your AI provider (LLM_PROVIDER: gemini, openai,
# openai-compatible, openrouter, groq, deepseek, ollama, vllm, or anthropic),
# set real credentials (LLM_API_KEY, GITHUB_TOKEN, RESEND_API_KEY,
# ON_CALL_ENGINEER_EMAIL), and replace placeholder security tokens
# (MCP_AUTH_TOKEN, GRAFANA_WEBHOOK_TOKEN, DASHBOARD_API_TOKEN,
# SETTINGS_ADMIN_TOKEN, and DECISION_HMAC_SECRET). Leave LLM_MODEL and
# LLM_FALLBACK_MODEL blank to use the selected provider's defaults (or set
# provider-compatible models; switching LLM_PROVIDER automatically resets
# stale model overrides saved in SQLite for the previous provider). For custom
# gateways or Ollama/vLLM with Docker, set a container-reachable LLM_BASE_URL
# (e.g., http://ollama:11434/v1 as a Compose service or a reachable host IP;
# host.docker.internal is Docker Desktop-specific unless Linux Docker Engine
# is configured with extra_hosts mapping host.docker.internal to host-gateway).

# 3. Install workspace dependencies
pnpm install --frozen-lockfile

# 4. Run the full quality gate (formatting, lint, typecheck, tests, build)
pnpm run check:workspace

# 5. Start the entire stack (LGTM observability + ZeroMTTR + User Manual)
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

| Symptom                                        | Likely Cause                                                                                                                                                                             | How to Fix                                                                                                                                                                                                                        |
| :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSE Offline** in War Room header             | Orchestrator still starting or stopped.                                                                                                                                                  | Check `docker compose ps` and `docker compose logs orchestrator`.                                                                                                                                                                 |
| **HTTP 403** when triggering Live Mode         | Missing/invalid `LIVE_DEMO_KEY` or expired Turnstile token.                                                                                                                              | Enter the key in the **Demo** drawer or complete Turnstile again.                                                                                                                                                                 |
| **HTTP 429** when simulating an incident       | Global cooldown (2 min) or rate limit active.                                                                                                                                            | Wait the number of seconds shown in the toast notification.                                                                                                                                                                       |
| **Flow stuck at `0. LGTM Collection`**         | Alert suppressed (`REPEAT_SUPPRESSION_SECONDS` / `REJECTION_COOLDOWN_SECONDS`) or Grafana waiting on `GRAFANA_ALERT_REPEAT_INTERVAL` (e.g., `15m`) because the target remained degraded. | Adjust suppression and **Auto-restore target on approval** in **Settings (⚙️)**, click **Restore Service** and wait ~30s before re-triggering, or lower `GRAFANA_ALERT_REPEAT_INTERVAL` in `.env` and run `docker compose up -d`. |
| **Settings in read-only mode**                 | `SETTINGS_ADMIN_TOKEN` not set in a demo environment.                                                                                                                                    | Set `SETTINGS_ADMIN_TOKEN` in `.env`, recreate the service (`docker compose up -d --force-recreate orchestrator`), and enter it in **Settings**.                                                                                  |
| **Target status `Unreachable`**                | Target offline or no recent metrics in Prometheus.                                                                                                                                       | Confirm the service is healthy (`GET /health`) and exporting OTLP telemetry.                                                                                                                                                      |
| **Expired link or `409 Conflict` on decision** | Link TTL expired or incident already approved/rejected.                                                                                                                                  | Each incident accepts a single final decision within its TTL (default 15 min).                                                                                                                                                    |
| **Toast "LLM model connection failed"**        | Missing/invalid API key, model incompatible with `LLM_PROVIDER`, quota exceeded, or unreachable `LLM_BASE_URL`.                                                                          | Check `LLM_MODEL`/`LLM_FALLBACK_MODEL` in **Settings (⚙️ → AI)** and `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_BASE_URL` in `.env`. When possible, diagnosis continues via deterministic fallback.                                  |
