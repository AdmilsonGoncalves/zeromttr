---
id: connect-service
title: Connecting Your Service
slug: /connect-service
sidebar_position: 6
---

# Connecting Your Service

ZeroMTTR's core is **domain-agnostic**. You can connect any HTTP workload that emits OpenTelemetry telemetry and is backed by a GitHub repository — with zero changes to ZeroMTTR's codebase.

## Minimum Workload Requirements

1. **OpenTelemetry (OTLP) telemetry:** export HTTP metrics, distributed traces, and logs to the stack's OTel Collector.
2. **GitHub repository:** accessible via a token permitted to inspect diffs and open branches/Pull Requests.
3. **Grafana alert rule:** configured to fire its webhook to the orchestrator when error rate or latency breaches your SLO.

## Choosing a Target Status Mode

### Mode 1 — Passive via Prometheus (zero changes to your service)

Best for existing or third-party services where you do not want to add custom endpoints.

Configure on the **orchestrator**:

```dotenv
TARGET_STATUS_PROVIDER=prometheus
TARGET_SERVICE_NAME=my-orders-api
TARGET_REPO_URL=https://github.com/my-org/my-orders-api
TARGET_BASE_BRANCH=main
```

In this mode:

- ZeroMTTR synthesizes throughput (req/s), 5xx error rate, and p95 latency from Prometheus metrics queried through the MCP server.
- If no telemetry series exist for the service, the War Room reports **Unreachable**.
- Chaos simulation controls are automatically disabled.

### Mode 2 — Cooperative Health Manifest (`GET /ops/status`)

Best when you want the War Room to show rich metadata such as current version, previous healthy version, and saturation for a specific resource (worker queue, DB pool, thread pool).

Configure on the **orchestrator**:

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

:::tip Turning off demo mode in production
Set `ENABLE_DEMO_MODE=false` for real deployments. This hides the **Demo** drawer in the War Room and disables simulation routes on the server while keeping **Settings** and the entire remediation pipeline active.
:::
