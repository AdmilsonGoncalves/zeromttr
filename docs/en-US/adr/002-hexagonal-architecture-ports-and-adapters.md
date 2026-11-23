# ADR-002: Hexagonal Architecture (Ports & Adapters) in Orchestrator and MCP Server

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

The core of ZeroMTTR must remain 100% agnostic to both the monitored service's domain and infrastructure technologies (HTTP, Express, MCP SDK, LLM providers, or observability APIs), ensuring high testability without real external calls.

## Decision

Adopt **Hexagonal Architecture (Ports & Adapters)** in `apps/orchestrator` and `apps/mcp-server`, structuring the unidirectional dependency flow:

```text
domain ──> application ──> ports <── adapters / http / transport
                                        └── main.ts (composition root)
```

Boundaries are automatically enforced by ESLint (`no-restricted-imports`) and verified in automated tests:

- `domain` and `application` **never** import `adapters`, `http`, `transport`, `@zeromttr/utils/http`, or infrastructure libraries (`express`, `axios`, `@modelcontextprotocol/sdk`).
- All dependency injection occurs exclusively in the *composition root* (`src/main.ts`).

## Consequences

### Positive

- FSM rules, evidence coverage, PII guard, FinOps, and summarization are tested with speed and determinism.
- Swapping providers (e.g., Gemini for another LLM, file persistence for PostgreSQL) requires only a new adapter implementing the corresponding port.

### Trade-offs

- A larger number of explicit interfaces (`ports/*.port.ts`) compared to an architecture coupled directly to SDKs.

## Rejected Alternatives

- **Direct coupling to Express/SDKs in the service layer:** would hinder deterministic testing and leak transport details into the domain.

## Code References

- `eslint.config.mjs`
- `apps/orchestrator/src/main.ts`, `apps/orchestrator/src/ports/`
- `apps/mcp-server/src/main.ts`, `apps/mcp-server/src/ports/`
- `apps/orchestrator/test/unit/hexagonal-boundary.spec.ts`
