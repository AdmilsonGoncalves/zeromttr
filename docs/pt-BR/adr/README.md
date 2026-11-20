# Architecture Decision Records (ADRs) — ZeroMTTR

Este diretório documenta as decisões arquiteturais estruturantes da plataforma **ZeroMTTR**, alinhadas ao [Documento Mestre de Arquitetura](../00_architecture_master.md) (§5.6).

| ID | Decisão | Status |
| :--- | :--- | :--- |
| [ADR-001](./001-monorepo-single-repo-and-demo-release-branch.md) | Monorepo único pnpm + Nx com `master` saudável (`v2.14.7`) e branch dedicada de regressão (`release/target-v2.14.8`) | Aceito |
| [ADR-002](./002-hexagonal-architecture-ports-and-adapters.md) | Arquitetura Hexagonal (Ports & Adapters) em `apps/orchestrator` e `apps/mcp-server` imposta por ESLint | Aceito |
| [ADR-003](./003-open-mcp-contract-streamable-http.md) | Contrato aberto via Model Context Protocol (MCP) sobre Streamable HTTP com 8 ferramentas | Aceito |
| [ADR-004](./004-llm-isolation-pii-guard-and-deterministic-fallback.md) | Isolamento de LLM atrás de `ReasoningPort`, `PiiPromptGuard` (fail-closed) e fallback determinístico | Aceito |
| [ADR-005](./005-defensive-truncation-and-finops-telemetry.md) | Truncamento defensivo por política e telemetria FinOps de redução de payload no servidor MCP | Aceito |
| [ADR-006](./006-token-segregation-and-email-only-hmac-decisions.md) | Segregação de 3 tokens de API e aprovação humana por HMAC exclusiva no `#fragment` do e-mail | Aceito |
| [ADR-007](./007-json-incident-persistence-and-replay-snapshot.md) | Persistência de incidentes em memória + arquivo JSON atômico e snapshot de modo Replay | Aceito |
| [ADR-008](./008-mcp-server-adapter-ownership.md) | Concentração das 8 ferramentas e adapters HTTP externos exclusivamente em `apps/mcp-server` | Aceito |
| [ADR-009](./009-otel-collector-ottl-transform-pii-masking.md) | Mascaramento de PII na borda via processor `transform` (OTTL) no OTel Collector | Aceito |
