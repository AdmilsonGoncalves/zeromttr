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

- **Rejection cooldown (Human Takeover):** suppression window for identical alerts after a human rejection.
- **Repeat suppression:** minimum quiet period before opening a new incident for the same alert after closure.
- **Decision link TTL:** expiration window for signed approval/rejection links sent by email.
- **Auto-restore target on approval:** controls whether approving an incident resets the demo target (automatically disabled when demo mode is off).

### 2. Target Service

- **Repository service path:** directory inspected during regression diff analysis.
- **Base and head refs:** baseline and suspect tags/refs compared when investigating.
- **5xx error rate threshold (%):** error percentage above which a Prometheus-monitored service is marked degraded.
- **Read-only metadata:** configured GitHub repository, PR base branch, active status provider, and Grafana interval.

### 3. AI & Observability

- **Primary and fallback LLM models:** models used to synthesize RCA and remediation patches.
- **On-call email:** always displayed in masked form (`on***@example.com`) to prevent PII exposure in the UI.
- **Orchestrator log level:** adjustable live (`debug`, `info`, `warn`, `error`).

### 4. Audit Log

- Chronological record of setting updates showing UTC timestamp, setting key, previous value, and new value (with email addresses always masked).

## Access Control & Read-Only Mode

- **Token-protected environments:** enter the **Settings Admin Token** at the top of the drawer to unlock saving. The token is stored only in the browser tab's `sessionStorage` and cleared when the tab closes.
- **Read-only mode:** on public demo instances where no admin token is configured, operators can inspect all live policies and audit history while saving remains disabled.
