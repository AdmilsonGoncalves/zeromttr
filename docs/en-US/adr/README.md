# Architecture Decision Records (ADRs) — ZeroMTTR

This directory documents the foundational architectural decisions of the **ZeroMTTR** platform, aligned with the [Master Architecture Document](../00_architecture_master.md) (§5.6).

| ID | Decision | Status |
| :--- | :--- | :--- |
| [ADR-001](./001-monorepo-single-repo-and-demo-release-branch.md) | Single pnpm + Nx monorepo with a healthy `master` (`v2.14.7`) and a dedicated regression branch (`release/target-v2.14.8`) | Accepted |
| [ADR-002](./002-hexagonal-architecture-ports-and-adapters.md) | Hexagonal Architecture (Ports & Adapters) in `apps/orchestrator` and `apps/mcp-server` enforced by ESLint | Accepted |
| [ADR-003](./003-open-mcp-contract-streamable-http.md) | Open contract via Model Context Protocol (MCP) over Streamable HTTP with 8 tools | Accepted |
| [ADR-004](./004-llm-isolation-pii-guard-and-deterministic-fallback.md) | LLM isolation behind `ReasoningPort`, `PiiPromptGuard` (fail-closed), and deterministic fallback | Accepted |
| [ADR-005](./005-defensive-truncation-and-finops-telemetry.md) | Policy-based defensive truncation and FinOps payload reduction telemetry in the MCP server | Accepted |
| [ADR-006](./006-token-segregation-and-email-only-hmac-decisions.md) | Segregation of 3 API tokens and human approval via HMAC exclusively in the email `#fragment` | Accepted |
| [ADR-007](./007-json-incident-persistence-and-replay-snapshot.md) | In-memory + atomic JSON file incident persistence and Replay mode snapshot | Accepted |
| [ADR-008](./008-mcp-server-adapter-ownership.md) | Consolidation of all 8 tools and external HTTP adapters exclusively in `apps/mcp-server` | Accepted |
| [ADR-009](./009-otel-collector-ottl-transform-pii-masking.md) | Edge PII masking via `transform` processor (OTTL) in the OTel Collector | Accepted |
