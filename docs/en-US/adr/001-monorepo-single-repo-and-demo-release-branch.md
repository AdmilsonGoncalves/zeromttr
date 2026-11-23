# ADR-001: Single pnpm + Nx Monorepo with Isolated Regression Branch for Demo

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

ZeroMTTR combines four applications (`orchestrator`, `mcp-server`, `dashboard`, and `target-app-demo`), two shared libraries (`libs/contracts` and `libs/utils`), and the local observability stack (`infra/`). Furthermore, the live demonstration requires a reproducible regression scenario in `target-app-demo` to generate real hotfix Pull Requests on GitHub without compromising the integrity of the main branch.

## Decision

1. Adopt a **single monorepo** managed with **pnpm workspaces** and **Nx**, centralizing shared contracts (`@zeromttr/contracts`), pure utilities (`@zeromttr/utils`), lint, typecheck, tests, and build in a single pipeline (`pnpm run check:workspace`).
2. Keep the **`master` branch always green and healthy** (tagged **`v2.14.7`**).
3. Isolate the controlled connection pool exhaustion regression (`KnexTimeoutError`) on the **`release/target-v2.14.8`** branch (tagged **`v2.14.8`**), used as the base for the real `v2.14.7...v2.14.8` diff and as the target for autonomous hotfix Pull Requests validated by `.github/workflows/hotfix-verify.yml`.

## Consequences

### Positive

- Typed contracts (`@zeromttr/contracts`) prevent drift across `orchestrator`, `mcp-server`, and `dashboard`.
- Any evaluator can run the entire ecosystem with a single `git clone` and `docker compose up -d`.
- Demo Pull Requests never pollute or break the `master` branch.

### Trade-offs

- Requires branch protection discipline (`master`) and tag protection (`v2.14.*`) on GitHub.
- The VPS deployment workflow must restrict triggers exclusively to `v1.*.*` tags or `workflow_dispatch`, ignoring `v2.14.*` tags.

## Rejected Alternatives

- **Multiple repositories (polyrepo):** would increase contract versioning friction and complicate local reproduction in a clean environment.
- **Injecting the bug directly into `master`:** would break main branch CI and violate engineering best practices.

## Code References

- `nx.json`, `pnpm-workspace.yaml`, `package.json`
- `.github/workflows/ci.yml`, `.github/workflows/hotfix-verify.yml`
- `apps/target-app-demo/src/repositories/payment.repository.ts`
