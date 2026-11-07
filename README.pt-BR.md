# ⚡ ZeroMTTR — AIOps Autônomo e Remediação de Incidentes

> **Trilha:** Logística & Automação (_Automação de fluxos operacionais e integração entre sistemas críticos_)  
> **Organização:** AGJ Works ([https://agjworks.com](https://agjworks.com))  
> **Repositório:** [https://github.com/AdmilsonGoncalves/zeromttr](https://github.com/AdmilsonGoncalves/zeromttr)  
> **Ambiente de Demonstração:** [https://zeromttr.agjworks.com](https://zeromttr.agjworks.com)

---

## 1. Visão Geral e Posicionamento

Em sistemas distribuídos de missão crítica — como liquidação de pagamentos instantâneos (PIX), separação e expedição logística, checkout ou faturamento — o tempo decorrido entre um alerta de degradação e a correção em produção ainda é dominado pelo trabalho manual fragmentado entre dashboards, logs e branches de código.

O **ZeroMTTR** é uma plataforma de AIOps 100% agnóstica ao domínio do serviço monitorado (_Clean Architecture_): qualquer aplicação que emita telemetria OpenTelemetry (OTLP) e possua um repositório Git pode ser monitorada e remediada autonomamente, sem nenhuma alteração no orquestrador ou no servidor MCP.

### Diferenciais Técnicos

| Recurso                          | HolmesGPT / OpenSRE                     | Datadog Bits / Sentry Seer           | ZeroMTTR                                                                                                                                                                 |
| :------------------------------- | :-------------------------------------- | :----------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modelo de Implantação**        | Self-hosted (CLI / ChatOps)             | SaaS proprietário                    | **100% Self-Hosted & Open Source** via contrato padrão **Model Context Protocol (MCP)**                                                                                  |
| **Proteção de PII na Borda**     | Sem proteção nativa para PII brasileira | Processamento na nuvem do fornecedor | **Dupla barreira:** OTTL `transform` regex no OTel Collector + **`PiiPromptGuard` (fail-closed)** com Módulo-11 (CPF/CNPJ), regras ANATEL, chaves PIX BACEN e Bearer/JWT |
| **Telemetria FinOps de Payload** | Dumps brutos de contexto                | Cobrança gerenciada no SaaS          | Rastreamento em tempo real de poda de bytes (`raw` vs `compacted`) e estimativa de tokens poupados                                                                       |
| **Governança de Remediação**     | Execução de scripts                     | PR interno do provedor               | **Pull Request de hotfix** contra branch de release com validação por CI (`hotfix-verify.yml`) + **Aprovação humana por HMAC enviado com exclusividade por e-mail**      |

---

## 2. Arquitetura e Modos de Execução

```text
Alerta Grafana (Webhook)
  ──> Orchestrator (FSM)
  <──> MCP Server (8 Tools: PromQL, Tempo, Loki, GitHub Diff)
  <──> Gemini LLM (via ReasoningPort auditado pelo PiiPromptGuard)
  ──> GitHub PR (branch hotfix/*) + E-mail Post-Mortem Resend (HMAC no #fragment)
  ──> Stream SSE em tempo real para o War Room Dashboard
```

### Modos Live vs. Replay

- **Modo Live:** Fluxo completo ponta a ponta com chamadas reais ao Google Gemini, criação de PR real no GitHub e envio de e-mail via Resend. Requer `LIVE_DEMO_KEY` na VPS pública para proteção de cotas.
- **Modo Replay:** Reprodução fiel e determinística para visitantes anônimos no ambiente de demonstração, garantindo a experiência interativa sem exaurir limites de API.

---

## 3. Desenvolvimento Local e Execução

### Pré-requisitos

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10+ (`packageManager`)
- Docker & Docker Compose v2.40+

### Inicialização

```bash
# Clonar e preparar variáveis
cp .env.example .env

# Instalar dependências
pnpm install --frozen-lockfile

# Executar checagens de qualidade no monorepo
pnpm run check:workspace

# Subir a stack local de observabilidade (Prometheus, Loki, Tempo, Grafana, OTel Collector)
docker compose up -d
```

Endpoints locais:

- War Room Dashboard: [http://localhost:4200](http://localhost:4200)
- Grafana: [http://localhost:3000](http://localhost:3000) (admin / change-me-strong-password)
- Prometheus: [http://localhost:9090](http://localhost:9090)
- OTel Collector: OTLP gRPC `4317` / HTTP `4318`

---

## 4. Documentação

- [Documento Mestre de Arquitetura](./docs/pt-BR/00_architecture_master.md)
- [Diagramas Comportamentais e de Rede](./docs/pt-BR/01_system_diagrams.md)
- [Documentos Técnicos por Fase (`docs/pt-BR/tech/`)](./docs/pt-BR/tech/)
- [Instruções para Agentes](./AGENTS.md)

---

## 5. Licença

MIT License — Copyright (c) 2026 AGJ Works.
