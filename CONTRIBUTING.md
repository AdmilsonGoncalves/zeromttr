# Contributing to ZeroMTTR

Thank you for your interest in contributing to **ZeroMTTR**. Please read these guidelines before opening a Pull Request so your changes align with the repository's architecture, quality gates, and security rules.

---

## 1. Prerequisites

- **Node.js 24 LTS** (pinned in `.nvmrc`)
- **pnpm 10+** (declared in `package.json#packageManager`)
- **Docker & Docker Compose v2.40+** (for local LGTM observability stack)

```bash
cp .env.prod.template .env
pnpm install --frozen-lockfile
```

---

## 2. Workspace Quality Gate

Every change must pass the full workspace check before opening a PR:

```bash
# Prettier + Nx lint, typecheck, test, and build across all apps and libs
pnpm run check:workspace

# Targeted execution for a single project
pnpm nx test orchestrator
pnpm nx test mcp-server
pnpm nx test dashboard
pnpm nx test target-app-demo
```

---

## 3. Architecture & Coding Standards

- **Hexagonal Architecture (`apps/orchestrator`, `apps/mcp-server`):**
  - Dependency direction: `domain` → `application` → `ports` ← `adapters` / `http` / `transport`, wired only in `src/main.ts`.
  - `domain` and `application` must **never** import `adapters`, `http`, `transport`, `@zeromttr/utils/http`, or external infrastructure libraries (`express`, `axios`, `@modelcontextprotocol/sdk`). This boundary is enforced by ESLint (`no-restricted-imports`) and automated tests.
- **Domain Isolation:** Keep `orchestrator` and `mcp-server` 100% domain-agnostic; never leak `target-app-demo` (`api-pagamentos-core`) business logic into the platform core.
- **Shared Utilities (`libs/utils` — `@zeromttr/utils`):**
  - Pure utilities (`string`, `object`, `array`, `date`, `number`, `json`, `error`) have zero external dependencies (no Lodash/Ramda) and may be imported by any layer.
  - HTTP helpers (`@zeromttr/utils/http`) are restricted to infrastructure/adapter layers.
- **File Naming:** Use `kebab-case` with dot-delimited role suffixes (e.g., `payment.repository.ts`, `decision.controller.ts`, `repo-inspector.port.ts`, `prometheus.http.ts`). Do not introduce internal barrel `index.ts` files inside `apps/*`.
- **Control Flow Braces:** Always wrap `if`, `else`, `for`, and `while` bodies in curly braces `{}` — even for single-line early returns.
- **TSDocs:** Keep TSDoc comments on exported classes, functions, and methods concise (1–3 lines) explaining intent rather than restating types.

---

## 4. Testing Strategy (Testing Trophy)

- **Integration & E2E first:** Prioritize `test/integration/` suites with reusable helpers in `test/helpers/`.
- **Unit tests:** Reserve `test/unit/` for pure domain logic (Modulo-11 validators, ANATEL/BACEN patterns, FinOps calculations, template rendering).
- **No Live External Calls in Automated Tests:** Never call real external APIs (Gemini, GitHub, Resend) in Vitest suites — use HTTP interceptors (`nock`) or in-memory port stubs.
- **Synthetic Data Only:** Never use real PII (CPF, CNPJ, phone, email, PIX keys) in fixtures, tests, logs, or documentation.

---

## 5. Git & Pull Request Workflow

1. Create a feature branch from `master` (never push directly to `master` and never use `git push --force`).
2. Follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), enforced by Commitlint (keep commit body lines ≤ 100 characters).
3. Never commit `.env` files, real credentials, or temporary local artifacts.
4. Do not modify or delete the demo baseline branch (`release/target-v2.14.8`) or tags (`v2.14.7`, `v2.14.8`).
5. Ensure `pnpm run check:workspace` is 100% green and open a Pull Request against `master`.
