# Documentación de ZeroMTTR (`es-ES`)

> **Read in English:** [`docs/en-US/`](../en-US/README.md) | **Leia em Português:** [`docs/pt-BR/`](../pt-BR/00_architecture_master.md)

Bienvenido a la documentación técnica en español (`es-ES`) de **ZeroMTTR** — una plataforma autónoma de AIOps y remediación de incidentes construida sobre **Arquitectura Limpia / Hexagonal** y un contrato abierto **Model Context Protocol (MCP)** sobre Streamable HTTP.

## Arquitectura Principal y Diagramas

- [Documento Maestro de Arquitectura (`00_architecture_master.md`)](./00_architecture_master.md) — Visión general, posicionamiento comparativo, aislamiento de dominio, KPIs y fases del proyecto
- [Diagramas y Flujos del Sistema (`01_system_diagrams.md`)](./01_system_diagrams.md) — Casos de uso, diagramas de secuencia E2E, límites de clases hexagonales y topología de red

## Registros de Decisión de Arquitectura (ADRs)

- [Índice de ADRs (`adr/README.md`)](./adr/README.md)
  - [ADR 001 — Monorepo Único y Rama de Release de Demo](./adr/001-monorepo-single-repo-and-demo-release-branch.md)
  - [ADR 002 — Arquitectura Hexagonal (Puertos y Adaptadores)](./adr/002-hexagonal-architecture-ports-and-adapters.md)
  - [ADR 003 — Contrato MCP Abierto sobre Streamable HTTP](./adr/003-open-mcp-contract-streamable-http.md)
  - [ADR 004 — Aislamiento de LLM, Guardia de PII y Fallback Determinista](./adr/004-llm-isolation-pii-guard-and-deterministic-fallback.md)
  - [ADR 005 — Truncamiento Defensivo y Telemetría FinOps](./adr/005-defensive-truncation-and-finops-telemetry.md)
  - [ADR 006 — Segregación de Tokens y Decisiones HMAC Exclusivas por Correo](./adr/006-token-segregation-and-email-only-hmac-decisions.md)
  - [ADR 007 — Persistencia JSON de Incidentes e Instantánea de Replay](./adr/007-json-incident-persistence-and-replay-snapshot.md)
  - [ADR 008 — Propiedad de Adaptadores en el Servidor MCP](./adr/008-mcp-server-adapter-ownership.md)
  - [ADR 009 — Enmascaramiento de PII mediante OTTL Transform en OTel Collector](./adr/009-otel-collector-ottl-transform-pii-masking.md)

## Especificaciones Técnicas (`tech/`)

- [TECH 01 — Base e Infraestructura](./tech/01_foundation_and_infrastructure.md)
- [TECH 02 — Servidor MCP](./tech/02_mcp_server.md)
- [TECH 03 — Aplicación Demo Objetivo (`api-pagamentos-core`)](./tech/03_target_app_demo.md)
- [TECH 04 — Integraciones de Socios (GitHub y Resend)](./tech/04_partner_integrations.md)
- [TECH 05 — Orquestador](./tech/05_orchestrator.md)
- [TECH 06 — Pruebas y Calidad](./tech/06_testing_and_quality.md)
- [TECH 07 — Demo en Vivo, Medición TTD/TTPR y Entrega Final](./tech/07_demo_and_delivery.md)
- [TECH 08 — Dashboard War Room Optimizado](./tech/08_dashboard_frontend.md)
- [TECH 09 — Contratos y Síntesis con LLM](./tech/09_contracts_and_llm_synthesis.md)
