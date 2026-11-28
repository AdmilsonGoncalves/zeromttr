---
id: settings
title: Live Runtime Settings
slug: /settings
---

# Live Runtime Settings

Clicking the **gear icon** in the top-right corner of the War Room opens the **Settings** drawer, available in both demo and production deployments.

Changes are persisted in local SQLite storage and take effect **immediately** without restarting containers.

## Available Tabs

### 1. Alerts & Decisions

- **Rejection cooldown (Human Takeover)** (`REJECTION_COOLDOWN_SECONDS`, `0`–`86400s`, default `900s`): suppression window for identical alerts after a human rejection. When an alert is suppressed, the War Room displays a warning toast with the remaining time.
- **Repeat suppression** (`REPEAT_SUPPRESSION_SECONDS`, `0`–`86400s`, default `60s` local / `900s` production): minimum quiet period before opening a new incident for the same alert after closure (`RESOLVED` or `REJECTED`). When suppressed, the War Room displays a warning toast with the remaining window and points to this tab.
- **Decision link TTL** (`DECISION_TTL_SECONDS`, `60`–`86400s`, default `900s`): expiration window for signed approval/rejection links sent by email.
- **Auto-restore target on approval** (`AUTO_RESTORE_ON_APPROVE`, default `true` in local demo / `false` in `.env.prod.template`): controls whether approving an incident resets the demo target (automatically disabled when `ENABLE_DEMO_MODE=false`).

### 2. Target Service

- **Repository service path** (`TARGET_SERVICE_PATH`): directory inspected during regression diff analysis.
- **Base and head refs** (`TARGET_BASE_REF` / `TARGET_HEAD_REF`): baseline and suspect tags/refs compared when investigating.
- **5xx error rate threshold (%)** (`TARGET_ERROR_RATE_THRESHOLD_PERCENT`, `0.1`–`100`): error percentage above which a Prometheus-monitored service is marked degraded.
- **Read-only metadata:** configured GitHub repository (`TARGET_GITHUB_REPO`), PR base branch (`TARGET_BASE_BRANCH`), active status provider (`TARGET_STATUS_PROVIDER`), and Grafana repeat interval (`GRAFANA_ALERT_REPEAT_INTERVAL`, default `1m` local / `15m` production — read-only because updating it requires editing `.env` and recreating the `grafana` container).

### 3. AI & Observability

- **Primary and fallback LLM models** (`LLM_MODEL` / `LLM_FALLBACK_MODEL`): models used by the active provider (`LLM_PROVIDER`: Gemini, OpenAI, `openai-compatible`, OpenRouter, Groq, DeepSeek, Ollama, vLLM, or Anthropic) to synthesize RCA and remediation patches, supporting namespaced model IDs (e.g., `openai/gpt-4o-mini`).
- **On-call email** (`ON_CALL_ENGINEER_EMAIL`): always displayed in masked form (`on***@example.com`) to prevent PII exposure in the UI.
- **Orchestrator log level** (`LOG_LEVEL`): adjustable live (`debug`, `info`, `warn`, `error`).

### 4. Audit Log

- Chronological record of setting updates showing UTC timestamp, setting key, previous value, and new value (with email addresses always masked).

## Precedence: SQLite vs. `.env`

- Values saved from the **Settings** drawer are persisted in the SQLite volume (`SETTINGS_DB_PATH`) and **take precedence over `.env`** across `orchestrator` container restarts.
- **LLM provider switch exception:** `LLM_PROVIDER` is always read from `.env` at startup; switching `LLM_PROVIDER` automatically clears stale `llmModel` and `llmFallbackModel` overrides in SQLite so the new provider's defaults take effect.

## Access Control & Read-Only Mode

- **Token-protected environments:** enter the **Settings Admin Token** at the top of the drawer to unlock saving. The token is stored only in the browser tab's `sessionStorage` and cleared when the tab closes.
- **Read-only mode:** on public demo instances where no admin token is configured, operators can inspect all live policies and audit history while saving remains disabled.
