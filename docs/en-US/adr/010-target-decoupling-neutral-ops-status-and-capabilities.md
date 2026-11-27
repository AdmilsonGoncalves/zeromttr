# ADR-010: Target Workload Decoupling via Neutral `/ops/status` Manifest & Prometheus Provider

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

In the initial MVP, the orchestrator and War Room Dashboard polled `/chaos/status` directly and assumed `api-pagamentos-core`-specific fields (`poolActive`, `poolWaiting`, `poolMax`). This coupled the platform core to the demo workload and made it harder to monitor external or legacy services that only emit OpenTelemetry (OTLP) telemetry.

## Decision

1. **Neutral `GET /ops/status` manifest with `TargetCapabilities` and `TargetSaturation`:** evolve `@zeromttr/contracts` with `capabilities: { chaosSimulation, healthyTrafficToggle }` and `saturation?: { resourceLabel, active, waiting, max }`, keeping transparent `404` fallback to `/chaos/status` inside `HttpTargetStatusAdapter`.
2. **Passive Prometheus provider (`TARGET_STATUS_PROVIDER=prometheus`):** add `PrometheusTargetStatusAdapter` behind `TargetStatusPort` querying Prometheus through MCP `ToolsPort`, enabling zero-endpoint monitoring of external services.
3. **Decoupled post-approval hook & SRP demo router:** `RecordDecision` stays strictly agnostic of `DemoControlPort` via an optional `onIncidentApproved` callback, while `apps/orchestrator/src/demo/` is split into `demo-session-lifecycle.ts`, `demo-guards.ts`, `demo-handlers.ts`, and `demo.controller.ts`.
4. **Data-driven & capability-gated dashboard:** `TargetTelemetryComponent`, charts, and `DemoSettingsComponent` (`app/shared/demo-settings/`) render simulation controls only when `demoModeEnabled` and `targetCapabilities` allow them.

## Consequences

### Positive

- Any OTel workload can be monitored and remediated without modifying `apps/orchestrator`, `apps/mcp-server`, or `apps/dashboard`.
- In production (`ENABLE_DEMO_MODE=false`), all `/api/demo/*` routes and demo UI controls are omitted automatically.

### Trade-offs

- Passive `TARGET_STATUS_PROVIDER=prometheus` mode provides neither pre-collector raw log previews nor chaos injection (`capabilities` return `false`), preserving operational neutrality.

## Rejected Alternatives

- **Keeping `/chaos/status` and PostgreSQL pool fields hardcoded:** violated the domain-agnostic architecture goal.

## Code References

- `libs/contracts/src/target-status/`
- `apps/target-app-demo/src/routes/ops.routes.ts`
- `apps/target-app-demo/src/controllers/ops-status.controller.ts`
- `apps/orchestrator/src/adapters/target-status.http.ts`
- `apps/orchestrator/src/adapters/target-status.prometheus.ts`
- `apps/orchestrator/src/demo/`
- `apps/dashboard/src/app/shared/demo-settings/`
