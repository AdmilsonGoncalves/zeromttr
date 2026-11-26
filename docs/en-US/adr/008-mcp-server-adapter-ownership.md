# ADR-008: Consolidation of Tools and External Adapters in the MCP Server

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

If both `apps/orchestrator` and `apps/mcp-server` maintained their own HTTP clients for Prometheus, Tempo, Loki, GitHub, Resend, and Grafana Annotations, authentication logic, truncation, error handling, and FinOps rules would be duplicated.

## Decision

Establish that **all HTTP adapters for external observability, code, and notification systems live exclusively in `apps/mcp-server/src/adapters/`**, exposed via the 8 MCP tools. `apps/orchestrator` interacts with these systems solely through the **`ToolsPort`** port, implemented by `McpToolsClientAdapter` (`apps/orchestrator/src/adapters/mcp.client.ts`).

The only direct HTTP communications from `orchestrator` outside MCP are the LLM (`ReasoningPort`) and target-service manifest/demo control (`HttpTargetStatusAdapter` polling `GET /ops/status` when `TARGET_STATUS_PROVIDER=manifest`, plus optional `DemoControlPort`). When `TARGET_STATUS_PROVIDER=prometheus`, even target health polling (`PrometheusTargetStatusAdapter`) routes exclusively through MCP `ToolsPort` (`execute_promql_range`), never bypassing the MCP server.

## Consequences

### Positive

- Single point of governance for credentials (`GITHUB_TOKEN`, `RESEND_API_KEY`, `GRAFANA_API_TOKEN`), truncation, and FinOps metrics.
- Any external MCP client automatically inherits the same protections and behaviors as the orchestrator.

### Trade-offs

- Adds one local HTTP hop (`orchestrator` → `mcp-server`) over the internal Docker network, with negligible latency (< 5 ms).

## Rejected Alternatives

- **Orchestrator calling observability APIs directly:** would break parity with the MCP contract and duplicate adapters.

## Code References

- `apps/mcp-server/src/adapters/`
- `apps/orchestrator/src/ports/tools.port.ts`
- `apps/orchestrator/src/adapters/mcp.client.ts`
