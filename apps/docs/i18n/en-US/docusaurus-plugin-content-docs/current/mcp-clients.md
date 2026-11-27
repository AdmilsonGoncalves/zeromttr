---
id: mcp-clients
title: MCP Client Integration
slug: /mcp-clients
---

# MCP Client Integration

ZeroMTTR exposes its observability, code inspection, and notification capabilities via the open **Model Context Protocol (MCP)** over Streamable HTTP.

You can connect **Claude Code**, **Claude Desktop**, **Cursor**, or **MCP Inspector** directly to investigate incidents using the same tools used by the orchestrator.

## Quick Setup (`.mcp.json`)

The repository root includes a ready-to-use `.mcp.json` configuration:

```json
{
  "mcpServers": {
    "zeromttr-aiops": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

Because `.env` is not automatically loaded into the MCP client's process environment, export `MCP_AUTH_TOKEN` in your shell before launching **Claude Code** (or another compatible client) so `${MCP_AUTH_TOKEN}` expands in the request header:

```bash
export MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-$(node --env-file-if-exists=.env -p "process.env.MCP_AUTH_TOKEN ?? ''")}"
claude
```

:::info Cursor users
Cursor reads project MCP configs from `.cursor/mcp.json` and uses `${env:MCP_AUTH_TOKEN}` syntax for environment variable interpolation. Export `MCP_AUTH_TOKEN` in your shell before launching the client.
:::

## Testing with MCP Inspector

With the local stack running:

```bash
export MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-$(node --env-file-if-exists=.env -p "process.env.MCP_AUTH_TOKEN ?? ''")}"
npx @modelcontextprotocol/inspector
```

In the Inspector, connect via **Streamable HTTP** to `http://localhost:8000/mcp` with header `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Available Tools (8)

| Category          | Tool                        | Purpose                                                                                     |
| :---------------- | :-------------------------- | :------------------------------------------------------------------------------------------ |
| **Metrics**       | `execute_promql_range`      | Runs PromQL queries on Prometheus with deterministic summarization and exemplar extraction. |
| **Traces**        | `analyze_otel_trace`        | Inspects a distributed span tree in Tempo and isolates the critical error span.             |
| **Traces**        | `search_traces_by_traceql`  | Searches recent error traces in Tempo filtered by service.                                  |
| **Logs**          | `query_loki_logs`           | Queries edge-redacted logs in Loki with policy truncation (FinOps).                         |
| **Code**          | `inspect_git_deploy_diff`   | Inspects the real GitHub diff between healthy and degraded releases.                        |
| **Remediation**   | `create_remediation_pr`     | Creates a `hotfix/*` branch and opens a Pull Request against the release branch.            |
| **Notification**  | `send_post_mortem_resend`   | Sends the post-mortem email with signed decision links.                                     |
| **Observability** | `annotate_grafana_incident` | Posts incident lifecycle annotations directly onto Grafana graphs.                          |
