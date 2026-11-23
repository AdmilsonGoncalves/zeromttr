# ADR-003: Open Contract via Model Context Protocol (MCP) over Streamable HTTP

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Proprietary AIOps tools typically lock their observability and remediation integrations behind internal code inaccessible to other clients. For the **Logistics & Automation** track, interoperability between critical systems and external agents is a central differentiator.

## Decision

Expose all observability, code inspection, and action capabilities of ZeroMTTR through a **Model Context Protocol (MCP)** compatible server over **Streamable HTTP** (`POST /mcp` authenticated via `Authorization: Bearer <MCP_AUTH_TOKEN>`), providing **8 standardized tools**:

1. `execute_promql_range`
2. `search_traces_by_traceql`
3. `analyze_otel_trace`
4. `query_loki_logs`
5. `inspect_git_deploy_diff`
6. `create_remediation_pr`
7. `send_post_mortem_resend`
8. `annotate_grafana_incident`

Include the `.mcp.json` manifest at the repository root as the baseline configuration for compatible MCP clients (MCP Inspector, Claude Code, Claude Desktop). For Cursor, the project configuration must be placed in `.cursor/mcp.json` using `${env:MCP_AUTH_TOKEN}` with the variable exported in the client's environment.

## Consequences

### Positive

- `apps/orchestrator` itself and any external MCP client consume the exact same contract validated by Zod schemas (`@zeromttr/contracts`).
- Facilitates independent auditing of the tools without needing to trigger the full incident workflow.

### Trade-offs

- Requires Bearer authentication management and strict payload validation on the HTTP `/mcp` endpoint.

## Rejected Alternatives

- **Exclusive `stdio` transport:** unfeasible for communication between isolated containers in Docker Compose and VPS production.
- **Proprietary REST API:** would lose native compatibility with the MCP agent ecosystem.

## Code References

- `.mcp.json`
- `apps/mcp-server/src/transport/mcp-server.ts`
- `apps/mcp-server/src/transport/tool-registry.ts`
- `libs/contracts/src/tools/`
