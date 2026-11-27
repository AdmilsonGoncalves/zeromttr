---
id: war-room
title: Using the War Room
slug: /war-room
sidebar_position: 2
---

# Using the War Room

The **War Room** is ZeroMTTR's single-pane mission control. It combines live connection status, the incident remediation timeline, target workload telemetry, technical evidence, and remediation controls.

## 1. Top Header

From left to right, the header shows:

- **Brand & live stream status:** indicates whether the real-time event stream (**SSE**) is connected (`Online` in green or `Offline` in red).
- **Monitored service status:** displays the target service name, current version, and health state:
  - **Healthy (green):** operating normally within thresholds.
  - **Degraded (amber):** active failure or saturation detected.
  - **Unreachable (red):** no response or no recent telemetry observed.
- **Right-side controls:**
  - **Demo:** opens the simulation drawer (shown only when demo mode is enabled).
  - **Settings (gear icon):** opens runtime operational policies and audit history (available in both demo and production).
  - **Manual (`?`):** opens this user guide in your active language.
  - **Language (flag):** switches immediately between **Português**, **English**, and **Español**.

## 2. Remediation Flow

Directly below the header, the horizontal timeline tracks the 8 incident stages in real time:

1. **LGTM Collect** — waiting for the observability alert to fire.
2. **Received** — alert validated and incident initialized.
3. **Investigating** — autonomous collection of metrics, traces, and logs.
4. **Enriching** — inspecting the code diff between healthy and degraded versions.
5. **Remediating** — privacy audit and root cause + patch synthesis.
6. **Opening PR** — creating the hotfix branch and opening the GitHub Pull Request.
7. **Notified** — post-mortem dispatched, awaiting human decision.
8. **Resolved / Rejected** — decision recorded and incident closed.

:::info Quick tip
Hover over any stage in the timeline to inspect a summary of what happens at that step.
:::

## 3. Target Workload Telemetry

Displays instantaneous health metrics for the monitored service:

- **Throughput (req/s)** and synthetic traffic activity indicator.
- **5xx Error Rate (%)** color-coded by severity (green, amber, or red).
- **p95 Latency (ms)** highlighting response-time degradation.
- **Resource Saturation** (when reported by the target, such as DB pool or worker queue) showing active and waiting counts.

## 4. KPI Strip

Summarizes key operational indicators for the active incident:

- **TTD (Time to Diagnose):** time from alert receipt to diagnosis completion.
- **TTPR (Time to Pull Request):** time until the remediation Pull Request is opened.
- **Evidence Coverage:** percentage of independent signals gathered (metrics, exemplar, error trace, and log/diff — up to `4/4` = `100%`).
- **Reasoning Source:** shows whether analysis came from **LLM Provider** or **Deterministic Fallback** (when the LLM is unavailable or blocked by the privacy guard).
- **FinOps Reduction:** percentage of raw evidence compacted before AI dispatch plus estimated tokens saved.

## 5. Evidence Panel (4 Tabs)

- **Live Metrics:** recent time series for p95 latency, 5xx rate, throughput, and saturation.
- **Trace Tree & Evidence:** distributed span tree highlighting the critical error span, blast radius, and root cause summary.
- **Loki Logs & PII Masking:** side-by-side comparison of raw edge logs (synthetic PII) vs. edge-redacted Loki logs, plus the fail-closed audit status.
- **Git Deploy Diff & FinOps:** suspect release code diff and visual breakdown of raw vs. compacted bytes.

## 6. Remediation Panel

Displays the **GitHub Pull Request** status (with a direct link for review), a sanitized preview of the **Post-Mortem email**, and — in demo mode — a button to simulate approval directly on screen.
