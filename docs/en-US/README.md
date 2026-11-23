# ZeroMTTR Documentation (`en-US`)

> **Leia em Português:** [`docs/pt-BR/`](../pt-BR/00_architecture_master.md)

Welcome to the English (`en-US`) technical documentation for **ZeroMTTR** — an autonomous AIOps and incident remediation platform built on **Clean / Hexagonal Architecture** and an open **Model Context Protocol (MCP)** Streamable HTTP contract.

## Core Architecture & Diagrams

- [Architecture Master Document (`00_architecture_master.md`)](./00_architecture_master.md) — Overview, comparative positioning, domain isolation, KPIs, and project phases
- [System Diagrams & Flows (`01_system_diagrams.md`)](./01_system_diagrams.md) — Use cases, E2E sequence diagrams, hexagonal class boundaries, and network topology
- [Phase 5 Baseline & Load Measurements (`phase-5-baseline.md`)](./phase-5-baseline.md) — Timed TTD/TTPR measurements vs. manual baseline and LGTM memory stability

## Architecture Decision Records (ADRs)

- [ADRs Index (`adr/README.md`)](./adr/README.md)
  - [ADR 001 — Monorepo Single Repo & Demo Release Branch](./adr/001-monorepo-single-repo-and-demo-release-branch.md)
  - [ADR 002 — Hexagonal Architecture (Ports & Adapters)](./adr/002-hexagonal-architecture-ports-and-adapters.md)
  - [ADR 003 — Open MCP Contract over Streamable HTTP](./adr/003-open-mcp-contract-streamable-http.md)
  - [ADR 004 — LLM Isolation, PII Guard & Deterministic Fallback](./adr/004-llm-isolation-pii-guard-and-deterministic-fallback.md)
  - [ADR 005 — Defensive Truncation & FinOps Telemetry](./adr/005-defensive-truncation-and-finops-telemetry.md)
  - [ADR 006 — Token Segregation & Email-Only HMAC Decisions](./adr/006-token-segregation-and-email-only-hmac-decisions.md)
  - [ADR 007 — JSON Incident Persistence & Replay Snapshot](./adr/007-json-incident-persistence-and-replay-snapshot.md)
  - [ADR 008 — MCP Server Adapter Ownership](./adr/008-mcp-server-adapter-ownership.md)
  - [ADR 009 — OTel Collector OTTL Transform PII Masking](./adr/009-otel-collector-ottl-transform-pii-masking.md)

## Technical Specifications (`tech/`)

- [TECH 01 — Foundation & Infrastructure](./tech/01_foundation_and_infrastructure.md)
- [TECH 02 — MCP Server](./tech/02_mcp_server.md)
- [TECH 03 — Target App Demo (`api-pagamentos-core`)](./tech/03_target_app_demo.md)
- [TECH 04 — Partner Integrations (GitHub & Resend)](./tech/04_partner_integrations.md)
- [TECH 05 — Orchestrator](./tech/05_orchestrator.md)
- [TECH 06 — Testing & Quality](./tech/06_testing_and_quality.md)
- [TECH 07 — Live Demo, TTD/TTPR Measurement & Final Delivery](./tech/07_demo_and_delivery.md)
- [TECH 08 — Streamlined War Room Dashboard](./tech/08_dashboard_frontend.md)
- [TECH 09 — Contracts & LLM Synthesis](./tech/09_contracts_and_llm_synthesis.md)
