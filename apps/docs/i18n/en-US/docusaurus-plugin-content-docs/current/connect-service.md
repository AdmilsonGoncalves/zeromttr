---
id: connect-service
title: Connecting Your Service
slug: /connect-service
---

# Connecting Your Service

ZeroMTTR's core is **domain-agnostic**. You can connect any HTTP workload that emits OpenTelemetry telemetry and is backed by a GitHub repository — with zero changes to ZeroMTTR's codebase.

## Minimum Workload Requirements

1. **OpenTelemetry (OTLP) telemetry:** export HTTP metrics, distributed traces, and logs to the stack's OTel Collector.
2. **GitHub repository:** accessible via a token (`GITHUB_TOKEN`) permitted to inspect diffs and open branches/Pull Requests. If you want automated verification on proposed patches, configure a CI workflow in the target repository for `hotfix/zeromttr-*` Pull Requests.
3. **Grafana alert rule:** configured to fire its webhook to the orchestrator when error rate or latency breaches your SLO.

## Repository Configuration (Orchestrator + MCP Server)

Regardless of the status mode below, set the target repository variables in the `.env` file shared by both the **orchestrator** and the **MCP server**:

```dotenv
TARGET_GITHUB_REPO=my-org/my-orders-api
TARGET_BASE_BRANCH=main
TARGET_SERVICE_PATH=apps/my-orders-api
```

> The `mcp-server` reads `TARGET_GITHUB_REPO`, `TARGET_BASE_BRANCH`, and `TARGET_SERVICE_PATH` to inspect diffs and open PRs; the orchestrator also supports `TARGET_REPO_URL` for the full repository link shown in the War Room.

## Choosing a Target Status Mode

### Mode 1 — Passive via Prometheus (zero changes to your service)

Best for existing or third-party services where you do not want to add custom endpoints.

Configure on the **orchestrator** (in addition to the repository variables above):

```dotenv
TARGET_STATUS_PROVIDER=prometheus
TARGET_SERVICE_NAME=my-orders-api
TARGET_REPO_URL=https://github.com/my-org/my-orders-api
```

In this mode:

- ZeroMTTR synthesizes throughput (req/s), 5xx error rate, and p95 latency from Prometheus metrics queried through the MCP server, supporting two HTTP histogram conventions:
  - `http_server_duration_milliseconds_{count,bucket}` with labels `service_name` and `http_status_code`, **or**
  - `http_request_duration_seconds_{count,bucket}` with labels `service` and `status`.
- If neither metric series is observed for `TARGET_SERVICE_NAME`, the War Room reports **Unreachable**.
- Chaos simulation controls are automatically disabled.

### Mode 2 — Cooperative Health Manifest (`GET /ops/status`)

Best when you want the War Room to show rich metadata such as current version, previous healthy version, and saturation for a specific resource (worker queue, DB pool, thread pool).

Configure on the **orchestrator** (in addition to the repository variables in the `.env` shared with the MCP server):

```dotenv
TARGET_STATUS_PROVIDER=manifest
TARGET_APP_URL=http://my-orders-api:8080
TARGET_STATUS_PATH=/ops/status
```

Example JSON payload for `GET /ops/status`:

```json
{
  "status": "healthy",
  "service": "my-orders-api",
  "version": "v3.2.0",
  "previousHealthyVersion": "v3.1.9",
  "targetRepo": "https://github.com/my-org/my-orders-api",
  "suspectFilePath": "src/workers/dispatch.ts",
  "capabilities": {
    "chaosSimulation": false,
    "healthyTrafficToggle": false
  },
  "metrics": {
    "requestsPerSecond": 42.5,
    "errorRate5xxPercent": 0.2,
    "p95LatencyMs": 85,
    "healthyTrafficActive": false,
    "saturation": {
      "resourceLabel": "Worker Queue",
      "active": 4,
      "waiting": 0,
      "max": 20
    }
  }
}
```

Fields such as `version`, `previousHealthyVersion`, `suspectFilePath`, and `metrics` enrich the War Room and guide the orchestrator's investigation, while `TARGET_GITHUB_REPO`, `TARGET_BASE_BRANCH`, and `TARGET_SERVICE_PATH` determine where the MCP server opens Pull Requests.

:::tip Turning off demo mode in production
Set `ENABLE_DEMO_MODE=false` for real deployments. This hides the **Demo** drawer in the War Room and disables simulation routes on the server while keeping **Settings** and the entire remediation pipeline active.
:::
