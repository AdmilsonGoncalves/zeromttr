# Registros de Decisiones de Arquitectura (ADR) — ZeroMTTR

Este directorio documenta las decisiones arquitectónicas fundacionales de la plataforma **ZeroMTTR**, alineadas con el [Documento Maestro de Arquitectura](../00_architecture_master.md) (§5.6).

| ID | Decisión | Estado |
| :--- | :--- | :--- |
| [ADR-001](./001-monorepo-single-repo-and-demo-release-branch.md) | Monorepo único con pnpm + Nx, rama `master` saludable (`v2.14.7`) y rama dedicada de regresión (`release/target-v2.14.8`) | Aceptado |
| [ADR-002](./002-hexagonal-architecture-ports-and-adapters.md) | Arquitectura Hexagonal (Puertos y Adaptadores) en `apps/orchestrator` y `apps/mcp-server` impuesta mediante ESLint | Aceptado |
| [ADR-003](./003-open-mcp-contract-streamable-http.md) | Contrato abierto mediante Model Context Protocol (MCP) sobre Streamable HTTP con 8 herramientas | Aceptado |
| [ADR-004](./004-llm-isolation-pii-guard-and-deterministic-fallback.md) | Aislamiento del LLM tras `ReasoningPort`, `PiiPromptGuard` (fail-closed) y respaldo determinista | Aceptado |
| [ADR-005](./005-defensive-truncation-and-finops-telemetry.md) | Truncado defensivo basado en políticas y telemetría FinOps de reducción de payload en el servidor MCP | Aceptado |
| [ADR-006](./006-token-segregation-and-email-only-hmac-decisions.md) | Segregación de 3 tokens de API y aprobación humana mediante HMAC exclusivamente en el `#fragment` del correo electrónico | Aceptado |
| [ADR-007](./007-json-incident-persistence-and-replay-snapshot.md) | Persistencia de incidentes en memoria + archivo JSON atómico y snapshot para el modo Replay | Aceptado |
| [ADR-008](./008-mcp-server-adapter-ownership.md) | Consolidación de las 8 herramientas y adaptadores HTTP externos exclusivamente en `apps/mcp-server` | Aceptado |
| [ADR-009](./009-otel-collector-ottl-transform-pii-masking.md) | Enmascaramiento de PII en el borde mediante el procesador `transform` (OTTL) en el OTel Collector | Aceptado |
| [ADR-010](./010-target-decoupling-neutral-ops-status-and-capabilities.md) | Desacoplamiento del servicio objetivo mediante manifiesto neutro `/ops/status`, `TargetCapabilities` y proveedor Prometheus | Aceptado |
| [ADR-011](./011-sqlite-runtime-settings-audit-log-and-admin-token.md) | Configuración operativa en runtime mediante SQLite (Node 24), auditoría y `SETTINGS_ADMIN_TOKEN` dedicado | Aceptado |
