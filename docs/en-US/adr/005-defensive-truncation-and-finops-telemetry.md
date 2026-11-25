# ADR-005: Policy-Based Defensive Truncation and FinOps Telemetry in the MCP Server

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Raw responses from Prometheus, Tempo, Loki, and GitHub Diff can reach hundreds of kilobytes in real incidents. Sending raw payloads directly to the LLM increases latency, raises token costs, and degrades context window quality.

## Decision

Implement summarization and **policy-based defensive truncation** in the domain layer of `apps/mcp-server` before returning results to the orchestrator:

- PromQL time series are summarized into essential statistics (`summarize-series.ts`).
- OTel traces are filtered to the critical path and error spans (`span-analysis.ts`).
- Loki logs and Git diffs enforce explicit line and **character** caps (`maxLines` and `maxChars` in `truncate.ts`; these are character-count limits, not direct UTF-8 byte caps).
- High-text-volume tools (`execute_promql_range`, `query_loki_logs`, and `inspect_git_deploy_diff`, excluding `analyze_otel_trace` and `search_traces_by_traceql`) compute and attach FinOps telemetry (`finops.ts`): `rawBytesFetched`, `compactedBytesSentToLlm`, reduction percentage, and a conservative estimate of tokens saved (`Math.round(bytesSaved / 4)`).

## Consequences

### Positive

- Drastically reduces the volume sent to the LLM (over 65%–90% depending on collected signal volume).
- Keeps the dashboard transparent about payload savings and prevents context window overflow.

### Trade-offs

- The tokens-saved metric is an **estimate proportional to payload size** (`bytes / 4`), not an exact count from the model's proprietary tokenizer.
- Evidence beyond the truncation limit is discarded: diffs include the explicit `... [TRUNCATED_DIFF]` marker, whereas `truncateLines` drops excess lines above `maxLines` without adding a truncation marker to the returned array.

## Rejected Alternatives

- **Sending raw telemetry dumps to the LLM:** high cost, unpredictable latency, and risk of exceeding context limits.
- **Integrating a single provider's specific tokenizer:** would create unnecessary dependency and reduce MCP server portability.

## Code References

- `apps/mcp-server/src/domain/finops.ts`
- `apps/mcp-server/src/domain/truncate.ts`
- `apps/mcp-server/src/domain/summarize-series.ts`
- `apps/mcp-server/src/domain/span-analysis.ts`
