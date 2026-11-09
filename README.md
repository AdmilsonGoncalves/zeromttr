# ⚡ ZeroMTTR — Autonomous AIOps & Incident Remediation

> **Track:** Logistics & Automation (_Operational workflow automation & mission-critical system integrations_)  
> **Author:** AGJ Works ([https://agjworks.com](https://agjworks.com))  
> **Repository:** [https://github.com/AdmilsonGoncalves/zeromttr](https://github.com/AdmilsonGoncalves/zeromttr)  
> **Demo URL:** [https://zeromttr.agjworks.com](https://zeromttr.agjworks.com)

---

## 1. Overview & Positioning

In mission-critical distributed systems — such as instant payment settlement (PIX), logistics fulfillment, e-commerce checkout, or billing — the mean time from alert to production fix is dominated by manual toil across siloed tools.

**ZeroMTTR** is a 100% domain-agnostic autonomous AIOps platform built following Clean Architecture principles: any workload emitting OpenTelemetry (OTLP) data and backed by a Git repository can be monitored and remediated without modifying the orchestrator or MCP server.

### Key Differentiators

| Capability                   | HolmesGPT / OpenSRE         | Datadog Bits / Sentry Seer | ZeroMTTR                                                                                                                                                                              |
| :--------------------------- | :-------------------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deployment Model**         | Self-hosted (CLI / ChatOps) | Proprietary SaaS           | **100% Self-Hosted & Open Source** via standard **Model Context Protocol (MCP)**                                                                                                      |
| **Edge PII Protection**      | Not native for BR PII       | Processed in cloud         | **Dual-barrier:** OTTL `transform` regex in OTel Collector + **`PiiPromptGuard` (fail-closed)** with CPF/CNPJ Modulo-11, ANATEL phone rules, BACEN PIX keys, and Bearer/JWT detection |
| **FinOps Payload Telemetry** | Raw context dumps           | SaaS managed               | Real-time byte pruning tracking (`raw` vs `compacted`) and token savings estimates                                                                                                    |
| **Remediation Governance**   | Automated script execution  | Proprietary PR opening     | **Hotfix PR** against release branch with automated CI gate (`hotfix-verify.yml`) + **Human-in-the-loop HMAC approval exclusively sent via email**                                    |

---

## 2. Architecture & Modes

```text
Grafana Alert (Webhook)
  ──> Orchestrator (FSM)
  <──> MCP Server (8 Tools: PromQL, Tempo, Loki, GitHub Diff)
  <──> Gemini LLM (via ReasoningPort audited by PiiPromptGuard)
  ──> GitHub PR (hotfix branch) + Resend Email Post-Mortem (HMAC #fragment)
  ──> Real-Time SSE to War Room Dashboard
```

### Live vs. Replay Modes

- **Live Mode:** Full end-to-end autonomous remediation pipeline with real Gemini API calls, real GitHub PR generation, and real Resend email dispatch. Requires `LIVE_DEMO_KEY` when deployed to public instances.
- **Replay Mode:** High-fidelity deterministic playback for anonymous visitors on public demo environments, safeguarding LLM API quotas while showing the exact production experience.

---

## 3. Local Development & Quickstart

### Prerequisites

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10+ (`packageManager`)
- Docker & Docker Compose v2.40+

### Setup

```bash
# Clone and prepare environment
cp .env.example .env

# Install dependencies
pnpm install --frozen-lockfile

# Run quality checks across monorepo
pnpm run check:workspace

# Spin up local observability stack (Prometheus, Loki, Tempo, Grafana, OTel Collector)
docker compose up -d
```

Access local endpoints:

- Dashboard: [http://localhost:4200](http://localhost:4200)
- Grafana: [http://localhost:3000](http://localhost:3000) (admin / change-me-strong-password)
- Prometheus: [http://localhost:9090](http://localhost:9090)
- OTel Collector: OTLP gRPC `4317` / HTTP `4318`

---

## 4. Documentation

- [Architecture Master Document (pt-BR)](./docs/pt-BR/00_architecture_master.md)
- [System Diagrams (pt-BR)](./docs/pt-BR/01_system_diagrams.md)
- [Technical Specs (`docs/pt-BR/tech/`)](./docs/pt-BR/tech/)
- [Agent Rules](./AGENTS.md)

---

## 5. License

MIT License — Copyright (c) 2026 AGJ Works.
