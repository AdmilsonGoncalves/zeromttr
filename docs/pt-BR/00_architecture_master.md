# ⚡ ZeroMTTR — Documento Mestre de Arquitetura e Plano de Projeto

| Campo | Valor |
| :--- | :--- |
| **Projeto** | ZeroMTTR — Autonomous AIOps & Incident Remediation |
| **Trilha Principal** | **Logística & Automação** (Automação de fluxos de trabalho operacionais e integrações autônomas entre sistemas críticos) |
| **Contexto Brasileiro (Workload Alvo)** | **`api-liquidacao-frete-pix`** — Motor de liquidação instantânea de frete e manifesto eletrônico de carga via PIX para operadores logísticos no Brasil |
| **Organização** | **AGJ Works** (`https://agjworks.com`) |
| **Ambiente de Produção (Demo)** | `https://zeromttr.agjworks.com` (VPS Linux + Traefik + Cloudflare) |
| **Repositório Principal (Plataforma)** | `https://github.com/AdmilsonGoncalves/zeromttr` |
| **Repositório Alvo de Hotfix (Workload)** | `https://github.com/AdmilsonGoncalves/zeromttr-target-pix-freight` (contém as tags reais `v2.14.7` saudável e `v2.14.8` com regressão) |
| **Status** | Planejamento (v0.3 — OTel/LGTM + MCP Aberto + GitHub Remediation em Repo Dedicado + Resend HMAC Isolado). Implementação 100% escrita do zero após 04/11/2026 21h00 BRT |
| **Diagramas do Sistema (UML / Rede)** | [`docs/pt-BR/01_system_diagrams.md`](./01_system_diagrams.md) (Casos de Uso, Sequência E2E, Classes Hexagonais e Topologia de Rede) |
| **Documentos Técnicos** | Fatias de implementação em [`docs/pt-BR/tech/`](./tech/) (ver §12) |

---

## 1. Introdução e Posicionamento

### 1.1 O Problema Real no Ecossistema de Logística e Pagamentos no Brasil
No setor de **logística e transporte de cargas no Brasil**, a liberação de caminhões em docas e centros de distribuição depende de microsserviços de **liquidação instantânea de frete via PIX e emissão de manifesto de carga (`api-liquidacao-frete-pix`)** operando 24×7. Durante janelas de pico logístico (fechamento de rotas e expedição noturna), uma regressão introduzida em um deploy — como o esgotamento de um pool de conexões PostgreSQL em transações PIX — paralisa a expedição física de frotas em minutos.

Enquanto isso, a resposta ao incidente sofre com três gargalos:
1. **Fragmentação manual:** ferramentas de observabilidade param no alerta textual, exigindo que o plantonista cruze manualmente métricas (Prometheus), traces (Tempo), logs (Loki) e commits recentes (GitHub).
2. **Risco de vazamento de PII brasileira ao usar IA:** logs de falha de liquidação logística carregam **CPF de motoristas autônomos, CNPJ de transportadoras, chaves PIX e tokens JWT/Bearer**. Colar esses logs brutos em LLMs externos viola políticas corporativas de privacidade e proteção de dados.
3. **Custo imprevisível de tokens:** enviar despejos brutos de séries temporais, árvores completas de spans e *git diffs* extensos estoura a janela de contexto e encarece o uso de LLMs em produção.

O **ZeroMTTR** automatiza esse fluxo operacional de ponta a ponta em segundos:

> **Alerta (Grafana) → Mascaramento de PII na Borda (OTel Collector `transform`) → RCA Agêntico via MCP (OTel/LGTM) → Correlação de Regressão no Deploy (`v2.14.7...v2.14.8` via GitHub API) → Pull Request Cirúrgico validado por CI no repositório-alvo → Post-mortem com aprovação humana assinada exclusivamente por e-mail (Resend HMAC).**

### 1.2 Posicionamento e Diferenciação (Estado da Arte em AI SRE)
A categoria de agentes para operações de TI conta com ferramentas relevantes de mercado e código aberto. O **ZeroMTTR** não propõe reinventar o conceito genérico de "alerta para PR", mas resolver **três lacunas negligenciadas** pelas soluções atuais quando aplicadas a ambientes *self-hosted* com dados sensíveis:

| Critério | HolmesGPT (CNCF) / OpenSRE | Datadog Bits AI / Sentry Seer | **ZeroMTTR (Este Projeto)** |
| :--- | :--- | :--- | :--- |
| **Modelo de Implantação** | Self-hosted (foco em investigação / ChatOps) | SaaS proprietário fechado (vendor lock-in) | **100% Self-Hosted & Open Source**, com contrato **MCP aberto** consumível por qualquer cliente MCP (Claude Desktop, Cursor, MCP Inspector ou Orchestrator próprio) |
| **Proteção de PII antes do LLM** | Depende de sanitização prévia não verificada pelo agente | Processado na nuvem do fornecedor SaaS | **Dupla barreira verificável:** (1) Mascaramento OTTL (`transform`) na borda do OTel Collector para CPF/CNPJ/PIX/JWT e (2) **`PiiPromptGuard`** determinístico que audita o prompt antes do envio ao LLM (`pii_patterns_detected_in_prompt: 0`) |
| **Auditoria FinOps de Tokens por Incidente** | Não mede compressão de payload por tool call | Opaco (cobrança embutida na licença SaaS) | **FinOps nativo no servidor MCP:** cada uma das 8 tools mede `raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`, comprovando ~94% de redução de contexto em tempo real |
| **Governança de Remediação** | Foco em diagnóstico; abertura de PR opcional sem gate HMAC por e-mail | Abre PR direto na plataforma SaaS | Abre **Pull Request em repositório-alvo isolado**, aciona CI de verificação (`hotfix-verify.yml`) e exige **aprovação humana via link HMAC exclusivo entregue por e-mail (Resend)** |

---

## 2. Objetivos e Métricas

### 2.1 Objetivo Geral
Entregar uma plataforma funcional, demonstrável ao vivo e de código aberto que automatize a investigação de causa raiz (RCA) e a preparação de Pull Requests de correção para incidentes em microsserviços, utilizando **Model Context Protocol (MCP)**, **OpenTelemetry**, **mascaramento verificável de PII na borda** e **governança com humano no circuito**.

### 2.2 Indicadores Operacionais Mensuráveis (KPIs)
Para evitar comparações distorcidas com processos que incluem deploy completo em produção, o ZeroMTTR mede especificamente o tempo até o diagnóstico determinístico (**TTD**) e o tempo até um Pull Request testado e pronto para revisão humana (**TTPR**), comparados contra um **baseline manual cronometrado** (os mesmos 7 passos executados manualmente por um engenheiro):

| KPI | Meta ZeroMTTR | Baseline Manual Cronometrado (7 passos) |
| :--- | :--- | :--- |
| **TTD (Time to Deterministic RCA + Deploy Diff)** | **≤ 15 s** | ~12 a 18 min (cruzar PromQL, exemplar, trace no Tempo, logs no Loki e `git diff`) |
| **TTPR (Time to Reviewable Hotfix PR no GitHub)** | **≤ 30 s** | ~25 a 40 min (isolar linha defeituosa, criar branch, codificar fix, rodar testes e abrir PR) |
| **Tempo até entrega do Post-Mortem assinado (Resend)** | **≤ 45 s** | ~45 a 60 min (redigir resumo executivo com evidências e links) |
| **Cobertura de testes automatizados (`domain/` + `application/`)** | **≥ 80 %** | — |

### 2.3 Cinco Diferenciais Técnicos Verificáveis
1. **Dupla Barreira de Mascaramento de PII na Borda + Auditoria Pré-LLM (`PiiPromptGuard`):** o OTel Collector aplica transformação OTTL (`replace_pattern` sobre `log.body` e atributos) mascarando CPF, CNPJ, Chave PIX e tokens Bearer/JWT antes de gravar no Loki; adicionalmente, o `PiiPromptGuard` inspeciona o prompt final antes do `ReasoningPort` e comprova `pii_patterns_detected_in_prompt === 0`.
2. **Telemetria FinOps / Token Economy no MCP:** cada tool calcula `raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`, exibindo no topo do dashboard a compressão de contexto em tempo real (ex.: `💰 Context Compression: 94.2% — Saved ~48k tokens`).
3. **Contrato MCP Aberto (Interoperável com Clientes Externos):** as 8 tools MCP não ficam presas ao orquestrador interno; o repositório inclui configuração `.mcp.json` permitindo demonstrar um cliente externo (**MCP Inspector / Cursor / Claude Desktop**) consultando a mesma stack LGTM e o diff do GitHub.
4. **Evidence Coverage Score (`0–100%` / `4 de 4 sinais`) & Blast Radius:** mede de forma transparente quantos sinais independentes convergiram para o diagnóstico (+25% anomalia PromQL, +25% `trace_id` via Exemplar, +25% Span com erro no Tempo, +25% Log correlacionado no Loki + commit isolado no diff `v2.14.7...v2.14.8`), degradando proporcionalmente (ex.: `75% — 3/4 sinais`) caso algum sinal esteja ausente, além de listar os serviços afetados (`services_involved`).
5. **Execução Live Real (< 25s) + Modo Replay Transparente para Visitantes:** o vídeo de demonstração e as avaliações com chave (`LIVE_DEMO_KEY`) ou via Docker local executam o **fluxo `Live` 100% real** (criando branch/PR real no repositório-alvo e enviando e-mail real via Resend). Na VPS pública aberta à internet, visitantes anônimos sem chave assistem por padrão ao modo `Replay` (claramente identificado na UI e no README) para proteger as cotas de API contra abuso.

### 2.4 Fora de Escopo (MVP)
Multi-tenant, alta disponibilidade multi-nó, merge automático em produção sem aprovação humana, armazenamento durável de longo prazo para métricas/logs/traces.

---

## 3. Escopo e Stakeholders

| Stakeholder | Interesse |
| :--- | :--- |
| Engenheiro de Plantão (SRE) / Operação Logística | Receber RCA correlacionado ao commit causador e Pull Request testado em segundos; aprovar ou rejeitar via link assinado no seu e-mail |
| Equipe de Plataforma / FinOps | Garantir que nenhum dado pessoal (CPF/CNPJ/PIX/JWT) seja enviado a LLMs externos e manter o consumo de tokens previsível |
| Desenvolvedores / Comunidade Open Source | Conectar qualquer cliente compatível com MCP (`.mcp.json`) às 8 tools de observabilidade e remediação |

---

## 4. Tecnologias Envolvidas

| Camada | Tecnologia | Papel |
| :--- | :--- | :--- |
| Runtime & Monorepo | **Node.js 24 LTS**, **pnpm** (`pnpm-workspace.yaml`), **Nx** (`nx.json`), TypeScript (`strict`, `ES2024`, `NodeNext`) | Orquestração de tarefas, cache de build/testes e pacotes em `apps/*` |
| Instrumentação | OpenTelemetry SDK (Node) | Emissão de traces, métricas (com exemplars) e logs estruturados |
| Ingestão & Sanitização | OTel Collector Contrib 0.114+ | `memory_limiter`, **`transform` (OTTL regex masking no `log.body` e atributos)**, `redaction` (spans), `tail_sampling` |
| Armazenamento | Prometheus (exemplars), Loki, Tempo | Stack LGTM |
| Visualização / Gatilho | Grafana 11.2+ (Alerting) | Webhook de incidente e API de anotações (`POST /api/annotations`) |
| Protocolo de Agente | **MCP** (`@modelcontextprotocol/sdk`) | Interface aberta padronizada de 8 tools de AIOps |
| LLM do Agente | Google Gemini API (`ReasoningPort`, modelo configurável via `LLM_MODEL`, padrão `gemini-2.0-flash`) | Seleção de tools (modo agêntico), síntese de RCA e geração de patch cirúrgico (com fallback determinístico sem LLM) |
| **Inspeção de Deploy & Auto-Remediação** | **GitHub REST API (Octokit)** sobre o repositório-alvo dedicado (`zeromttr-target-pix-freight`) | Comparação real entre as tags `v2.14.7...v2.14.8`, leitura de código, criação de branch `hotfix/zeromttr-*` e abertura de Pull Request |
| **Notificação e Governança** | **Resend** | Entrega do Post-Mortem em HTML (`sre@zeromttr.agjworks.com`) contendo com exclusividade os links de decisão assinados via HMAC |
| Testes | Vitest, Supertest, `nock`/MSW | TDD para domínio, casos de uso e contract tests dos adapters HTTP |
| Qualidade | ESLint, Prettier, Husky + lint-staged, Commitlint | Padrões de código e imposição de fronteiras hexagonais |
| Infraestrutura | Docker, Docker Compose | Execução local (`docker-compose.yml`) e em produção na VPS (`docker-compose.prod.yml`) |
| CI/CD | GitHub Actions | `ci.yml`, `cd-release.yml` (deploy na VPS congelado apenas para tags `v*` ou disparo manual) e `hotfix-verify.yml` no repositório-alvo |
| Workload Demo | Express + Knex + PostgreSQL | Serviço `api-liquidacao-frete-pix` com falha reproduzível de saturação de pool em liquidação de frete |
| Frontend | **Angular (última versão estável)**, **PrimeNG (preset Aura Dark)**, Tailwind CSS v4 + `tailwindcss-primeui` | War Room Dashboard enxuto (Single-Pane, 4 quadrantes) + rota `/decision/:id` |

---

## 5. Arquitetura do Sistema

### 5.1 Estilo Arquitetural
| Aspecto | Decisão |
| :--- | :--- |
| Estilo macro | **Event-driven + Agentic** (webhook dispara o agente; fallback determinístico garante conclusão caso o LLM falhe) |
| Estilo interno | **Hexagonal (Ports & Adapters) / Clean Architecture** em `apps/orchestrator` e `apps/mcp-server` |
| Comportamento | **Máquina de Estados Finitos (FSM)** pura controlando o ciclo de vida do incidente |
| Integração | **MCP sobre HTTP** (Streamable HTTP; compatível com clientes externos via `.mcp.json`) |
| Segurança de Decisão | **HMAC exclusivo por e-mail:** assinaturas de aprovação/rejeição trafegam apenas no e-mail enviado pelo Resend, nunca no SSE ou em endpoints públicos de leitura |
| Implantação | Local via `docker-compose.yml` · Produção em **VPS Linux** via `docker-compose.prod.yml` + **Traefik + Cloudflare**, lendo segredos de arquivo externo ao repositório (ex.: `/path/to/secrets/.env`) |

### 5.2 Padrões por Componente
| Componente | Padrão | Organização |
| :--- | :--- | :--- |
| `apps/orchestrator/` e `apps/mcp-server/` | **Hexagonal (Ports & Adapters)** | `domain` → `application` → `ports` → `adapters`, com composition root em `main.ts` |
| `apps/target-app-demo/` | **MVC em camadas** | `routes` → `controllers` → `services` → `repositories` (`PixSettlementRepository`) |
| `apps/dashboard/` | **Single-Pane War Room com Signals** (Angular + PrimeNG Aura Dark) | Standalone Components (`WarRoomComponent` + `DecisionComponent`) focado no fluxo principal de 3 minutos |

### 5.3 Visão de Contexto (C4 Nível 1)
```mermaid
flowchart TD
    SRE(["Engenheiro de Plantão (SRE)"])
    EXT_MCP(["Cliente MCP Externo (Cursor / Claude / Inspector)"])
    APP["Workload Logístico: api-liquidacao-frete-pix (OTel SDK)"]
    ZMT[["ZeroMTTR Platform (MCP Server + Orchestrator + LGTM)"]]
    LLM["Provedor LLM (Gemini API — Zero PII)"]
    GH["GitHub API & Repo Alvo (zeromttr-target-pix-freight: tags v2.14.7..v2.14.8)"]
    RS["Resend API (E-mail Post-Mortem com HMAC exclusivo)"]

    APP -->|"1. Telemetria OTLP (Métricas, Logs com CPF/PIX, Traces)"| ZMT
    EXT_MCP -.->|"Consome as 8 Tools via Contrato MCP Aberto"| ZMT
    ZMT <-->|"2. Raciocínio RCA & Patch (Validado por PiiPromptGuard)"| LLM
    ZMT <-->|"3. Inspeciona Diff real v2.14.7..v2.14.8 e abre PR hotfix/*"| GH
    ZMT -->|"4. Envia Post-Mortem HTML com links HMAC exclusivos"| RS
    RS -->|"5. E-mail com diagnóstico e links /decision/:id"| SRE
    SRE -->|"6. Confirma Aprovação/Rejeição via POST com HMAC do e-mail"| ZMT
    SRE -.->|"Merge final autorizado no repo-alvo"| GH
```

### 5.4 Visão de Contêineres (C4 Nível 2)
```mermaid
flowchart TD
    subgraph Workload["Serviço Logístico Monitorado"]
        DEMO["target-app-demo: api-liquidacao-frete-pix (Express + Knex + OTel)"]
    end

    subgraph Observability["Camada de Observabilidade (OTel + LGTM)"]
        OTEL["OTel Collector (OTTL Transform PII Masking + Tail Sampling)"]
        PROM[("Prometheus (Exemplars)")]
        LOKI[("Grafana Loki (Logs Sanitizados)")]
        TEMPO[("Grafana Tempo (Traces)")]
        GRAF["Grafana Alerting & Annotations"]
    end

    subgraph ZeroMTTR["Núcleo Agêntico ZeroMTTR"]
        DASH["War Room Dashboard (Angular + Nginx Proxy c/ DASHBOARD_API_TOKEN)"]
        ORCH["Orchestrator (Webhook + FSM + PiiPromptGuard + SSE)"]
        MCP["MCP Server (8 Tools + FinOps Telemetry)"]
    end

    subgraph External["APIs Externas & Repo Alvo"]
        LLM["Gemini API (ReasoningPort)"]
        GH["GitHub REST API (Repo: zeromttr-target-pix-freight)"]
        RS["Resend API (Post-Mortem c/ HMAC)"]
    end

    DEMO -->|"OTLP/HTTP 4318"| OTEL
    OTEL --> PROM & LOKI & TEMPO
    PROM & LOKI & TEMPO --> GRAF
    GRAF -->|"POST /webhook/grafana-alert (GRAFANA_WEBHOOK_TOKEN)"| ORCH
    DASH <-->|"/api/* + SSE Stream (sem decisionToken)"| ORCH
    ORCH <-->|"MCP Streamable HTTP (MCP_AUTH_TOKEN)"| MCP
    ORCH <-->|"Prompt Auditado (0 PII)"| LLM
    MCP -->|"PromQL / LogQL / TraceQL"| PROM & LOKI & TEMPO
    MCP -->|"POST /api/annotations"| GRAF
    MCP <-->|"Compare Tags v2.14.7..v2.14.8 & Create PR"| GH
    MCP -->|"POST /emails"| RS
```

### 5.5 Máquina de Estados do Incidente (FSM)
```mermaid
stateDiagram-v2
    direction TB
    [*] --> RECEIVED: Webhook Grafana (202 Accepted)
    RECEIVED --> INVESTIGATING: Deduplicação por fingerprint
    INVESTIGATING --> ENRICHING: Coleta OTel concluída (PromQL + Tempo + Loki)
    INVESTIGATING --> FAILED: Sem evidência / erro crítico
    ENRICHING --> REMEDIATING: Diff real v2.14.7..v2.14.8 inspecionado no repo-alvo
    REMEDIATING --> AWAITING_PR: Patch validado pelo PiiPromptGuard e branch hotfix/* criada
    AWAITING_PR --> NOTIFIED: Pull Request aberto no repo-alvo
    AWAITING_PR --> FAILED: Timeout / erro na API GitHub
    NOTIFIED --> RESOLVED: Aprovação humana (HMAC exclusivo do e-mail ou simulação autorizada)
    NOTIFIED --> REJECTED: Rejeição humana (HMAC exclusivo do e-mail ou simulação autorizada)
    RESOLVED --> [*]
    REJECTED --> [*]
    FAILED --> [*]
```

> [!NOTE]
> Para a modelagem detalhada **comportamental** (Diagrama de Casos de Uso e Diagrama de Sequência Ponta a Ponta) e **estática** (Diagramas de Classes Hexagonais de `apps/orchestrator` e `apps/mcp-server` e Topologia de Isolamento de Rede na VPS), consulte [`01_system_diagrams.md`](./01_system_diagrams.md).

### 5.6 Decisões Arquiteturais (ADRs Resumidos)
| ID | Decisão | Motivo | Alternativa Descartada |
| :--- | :--- | :--- | :--- |
| ADR-001 | Monorepo **pnpm + Nx** (package-based) em `apps/*` para a plataforma + repositório público dedicado (`zeromttr-target-pix-freight`) para o alvo de PRs | Mantém o repositório principal limpo (CI sempre verde, sem PRs gerados pela demo poluindo a árvore principal) enquanto permite tags reais `v2.14.7`/`v2.14.8` e PRs reais no repositório-alvo | Abrir PRs autônomos dentro do próprio monorepo da plataforma |
| ADR-002 | Arquitetura Hexagonal no orquestrador e no MCP | Domínio isolado de HTTP e SDKs externos; testabilidade em TDD com fakes | Camadas acopladas |
| ADR-003 | MCP como contrato aberto de ferramentas (`.mcp.json` incluso) | Permite que tanto o `orchestrator` quanto clientes externos (Cursor/Claude/Inspector) consumam as mesmas 8 tools | Chamadas REST internas ad hoc |
| ADR-004 | LLM isolado atrás de `ReasoningPort` + `PiiPromptGuard` + Fallback Determinístico | Garante auditoria zero-PII antes da chamada externa e continuidade operacional mesmo se o provedor de LLM falhar | Chamada direta ao SDK sem guard-rail |
| ADR-005 | Truncamento defensivo e FinOps no MCP | Controle estrito de tokens e medição exata de bytes economizados por tool call | Envio de payloads brutos |
| ADR-006 | Segregação de tokens e **HMAC exclusivo no e-mail** para aprovação humana | Impede que visitantes da demo pública leiam o `decisionToken` via SSE/REST e aprovem incidentes sem acesso ao e-mail do plantonista | Expor `decisionToken` na API do dashboard ou usar o mesmo token para webhook e UI |
| ADR-007 | Persistência de incidentes em memória + arquivo JSON (MVP) | Simplicidade operacional e suporte nativo a gravação de artefatos para o modo Replay | Banco relacional dedicado para o orquestrador |
| ADR-008 | As 8 tools e seus adapters HTTP vivem em `apps/mcp-server`; `apps/orchestrator` consome via `ToolsPort` | Zero duplicação de adapters; servidor MCP 100% autônomo | Adapters duplicados nos dois serviços |
| ADR-009 | Mascaramento de PII em logs via processor **`transform` (OTTL `replace_pattern`)** no OTel Collector | Garante sanitização determinística diretamente no `log.body` e atributos em qualquer versão do Collector 0.114+ | Depender apenas do processor `redaction` (restrito a atributos de span em algumas versões) |

---

## 6. Princípios e Regras de Desenvolvimento

### 6.1 TDD (Obrigatório no Domínio e nos Guard-Rails)
Ciclo **Red → Green → Refactor** para domínio, casos de uso, `PiiPromptGuard` e adapters.
- Todo caso de uso nasce de um teste que falha, escrito antes da implementação.
- Adapters externos (GitHub API, Resend, Prometheus, Loki, Tempo, Grafana) são testados com *contract tests* e mocks HTTP (`nock`/MSW). **Nunca chamam a API real em CI.**
- Pirâmide: ~70 % unitários, ~20 % integração, ~10 % E2E.
- Meta de cobertura: ≥ 80 % em `domain/` e `application/`.

### 6.2 SOLID Aplicado
| Princípio | Aplicação Concreta |
| :--- | :--- |
| **S** | Um arquivo por tool; um caso de uso por classe |
| **O** | Novos adapters (outro LLM, outro provedor Git, outro canal de notificação) sem alterar o domínio |
| **L** | Qualquer implementação de port é substituível por fake |
| **I** | Ports coesos: `MetricsPort`, `LogsPort`, `TracesPort`, `RepoInspectorPort`, `RemediationPort`, `NotifierPort`, `AnnotationPort` |
| **D** | Casos de uso dependem exclusivamente de ports; composição em `main.ts` |

### 6.3 Outras Regras
- **Clean Code / DRY / YAGNI / KISS**; funções pequenas, sem `any` fora de fronteiras (usar `zod` para validar entradas externas).
- **Idioma:** código, tools, logs e commits em en-US; documentação principal e README em en-US e pt-BR.
- **Segurança por padrão:** três tokens distintos (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`), `decisionToken` restrito ao e-mail, escape de HTML nos templates, redaction OTTL na borda + `PiiPromptGuard` pré-LLM.

---

## 7. Estrutura de Pastas (Monorepo pnpm + Nx)

```text
zeromttr/
├── package.json                  # Scripts raiz delegando ao Nx (check:workspace, lint:workspace, test:workspace, build:workspace)
├── pnpm-workspace.yaml           # packages: ['apps/*']
├── nx.json                       # Task pipeline, cache e affected (Nx package-based)
├── tsconfig.base.json            # Strict TS config compartilhado
├── .mcp.json                     # Configuração pronta para conectar clientes MCP externos (Inspector / Cursor / Claude)
├── .nvmrc                        # Node 24
├── .dockerignore                 # Mantém contexto de build Docker < 2 MB
├── README.md                     # en-US (inclui trilha, posicionamento e distinção Live vs Replay)
├── README.pt-BR.md
├── AGENTS.md                     # Contexto e regras para agentes de codificação
├── LICENSE                       # MIT
├── docker-compose.yml            # Ambiente local de desenvolvimento
├── docker-compose.prod.yml       # VPS Linux (Traefik + limites seguros de RAM + env_file externo, zero ports no host)
├── .github/workflows/
│   ├── ci.yml                    # Lint, typecheck, Gitleaks, Vitest (≥80%), Compose smoke (via pnpm + Nx)
│   └── cd-release.yml            # Push GHCR em main/tags; deploy na VPS congelado APENAS para tags v* ou workflow_dispatch
├── .env.example                  # Template local (dev)
├── .env.prod.template            # Template de produção na VPS (ex.: /path/to/secrets/.env)
├── infra/
│   ├── otel-collector-config.yaml
│   ├── otel-collector-config.prod.yaml
│   ├── prometheus.yml
│   ├── tempo-config.yaml
│   ├── loki-config.yaml
│   └── grafana/provisioning/
│       ├── datasources/datasources.yaml
│       └── alerting/{rules.yaml,contact-points.yaml,policies.yaml}
├── apps/
│   ├── mcp-server/               # Hexagonal (8 tools + FinOps telemetry + adapters LGTM/GitHub/Resend)
│   │   ├── src/
│   │   │   ├── domain/           # summarize-series, truncate, span-analysis, finops
│   │   │   ├── application/      # casos de uso (uma tool = um caso de uso)
│   │   │   ├── ports/            # MetricsPort, LogsPort, TracesPort, RepoInspectorPort, RemediationPort, NotifierPort, AnnotationPort
│   │   │   ├── adapters/         # prometheus, loki, tempo, github-inspector, github-remediation, resend, grafana-annotations (HTTP)
│   │   │   ├── transport/        # servidor MCP Streamable HTTP + auth
│   │   │   ├── config/
│   │   │   └── main.ts           # composition root
│   │   └── test/{unit,integration,contract}/
│   ├── orchestrator/             # Hexagonal + FSM + PiiPromptGuard
│   │   ├── src/
│   │   │   ├── domain/           # Incident, IncidentState (FSM), RcaReport, EvidenceCoverage, DecisionHmac, PiiPromptGuard
│   │   │   ├── application/      # HandleAlert, InvestigateIncident, EnrichWithDeployDiff, DispatchRemediation, NotifyOnCall, RecordDecision
│   │   │   ├── ports/            # ReasoningPort, ToolsPort (MCP client), IncidentRepository, TargetStatusPort, Clock
│   │   │   ├── adapters/         # llm.gemini (com PiiPromptGuard), mcp.client, repo.file, target-status.http
│   │   │   ├── http/             # webhook Grafana (GRAFANA_WEBHOOK_TOKEN), API REST (DASHBOARD_API_TOKEN), decisões HMAC, SSE
│   │   │   └── main.ts
│   │   └── test/
│   ├── target-app-demo/          # MVC em camadas (api-liquidacao-frete-pix — emissor OTel local)
│   │   ├── src/{routes,controllers,services,repositories,models,telemetry,chaos}/
│   │   └── test/
│   └── dashboard/                # Angular + PrimeNG (Aura Dark) War Room enxuto, Fase 4b
├── scripts/                      # demo.sh, chaos.sh, reset.sh, measure-mttr.sh, smoke-integrations.sh
└── docs/
    ├── pt-BR/
    │   ├── 00_architecture_master.md
    │   ├── 01_system_diagrams.md # Casos de Uso, Sequência E2E, Classes Hexagonais e Topologia de Rede
    │   ├── tech/                 # documentos de implementação por fatia (01 a 08)
    │   └── adr/
    └── en-US/
```

---

## 8. Fases do Projeto e Entregas

| Fase | Objetivo | Entregáveis | Critério de Aceite (DoD da Fase) |
| :--- | :--- | :--- | :--- |
| **0 — Planejamento** | Arquitetura v0.3, diagramas UML, especificações técnicas e credenciais | Este documento, `01_system_diagrams.md`, `tech/01..08.md` | Especificações revisadas e sem pontas soltas |
| **1 — Fundação** | Monorepo (`pnpm` + `Nx`), CI, stack LGTM com `transform` OTTL para PII | `pnpm-workspace.yaml`, `nx.json`, `docker-compose`, `infra/`, CI verde | `docker compose up` saudável; Collector mascara CPF/CNPJ/PIX/JWT em `log.body` |
| **2 — MCP Server (TDD)** | 8 tools com ports/adapters, FinOps e `.mcp.json` | `apps/mcp-server/` com testes, auth e suporte a MCP Inspector externo | Cobertura ≥ 80 %; 8 tools respondem ao Orchestrator e ao MCP Inspector |
| **3 — Demo App + Repo Alvo** | Workload `api-liquidacao-frete-pix` + repo `zeromttr-target-pix-freight` (`v2.14.7` e `v2.14.8`) | `apps/target-app-demo/`, tags reais `v2.14.7`/`v2.14.8` no repo-alvo com `hotfix-verify.yml` | Falha dispara alerta no Grafana; `compare/v2.14.7...v2.14.8` retorna diff real no GitHub |
| **4 — Orquestrador (TDD)** | Webhook segregado, FSM, `PiiPromptGuard`, GitHub PR, Resend HMAC exclusivo | `apps/orchestrator/` com testes de segurança e auditoria de prompt | E2E: alerta → diff → PR no repo-alvo → e-mail em < 30 s; zero `decisionToken` no SSE |
| **4b — Dashboard Enxuto** | War Room Dashboard focado no roteiro de 3 min | `apps/dashboard/` (`WarRoomComponent` + `DecisionComponent`), mock server e Nginx | Golden path completo na tela com mock e com orquestrador real |
| **5 — Hardening & Baseline** | Medição cronometrada de TTD/TTPR e testes sob carga nos limites de RAM | `measure-mttr.sh`, baseline documentado, testes E2E | TTD/TTPR medidos contra baseline manual; LGTM estável sob carga |
| **6 — Release & Submissão** | Documentação final, vídeo de 3 min em modo `Live` e deploy congelado na VPS | README en/pt-BR, release `v1.0.0` implantada na VPS | Checklist de entrega 100 % cumprido (ver `tech/07`) |

```mermaid
flowchart TD
    F0["0. Planejamento & Diagramas (v0.3)"] --> F1["1. Fundação (pnpm + Nx + LGTM c/ OTTL Transform)"]
    F1 --> F2["2. MCP Server (8 Tools + FinOps + .mcp.json em TDD)"]
    F1 --> F3["3. Workload PIX Frete + Repo Alvo (tags v2.14.7 e v2.14.8)"]
    F1 --> F4B["4b. War Room Dashboard Enxuto (Agente Frontend)"]
    F2 & F3 --> F4["4. Orquestrador (FSM + PiiPromptGuard + PR + Resend HMAC)"]
    F4 & F4B --> F5["5. Hardening, Teste de Carga LGTM & Medição TTD/TTPR"]
    F5 --> F6["6. Vídeo Live (3 min) & Release v1.0.0 Congelada na VPS"]
```

---

## 9. Requisitos Não Funcionais

| Atributo | Requisito |
| :--- | :--- |
| Desempenho | TTD (RCA + Diff) ≤ 15 s; TTPR (abertura de PR) ≤ 30 s; respostas de tool ≤ 5 s (p95) |
| Economia de Tokens (FinOps) | ≤ 500 chars/linha de log, ≤ 100 linhas, ≤ 1500 chars/diff do GitHub, ≤ 5 séries PromQL |
| Segurança e Governança | Três tokens segregados (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`); `decisionToken` enviado **apenas** no e-mail; PII mascarada na borda (OTTL `transform`) e auditada pré-LLM (`PiiPromptGuard`) |
| Confiabilidade | Timeouts; retry com backoff; idempotência por `incident_id`; deduplicação de alertas por fingerprint; fallback determinístico se o LLM falhar |
| Estabilidade de Produção | Deploy na VPS acionado apenas em tags `v*.*.*` ou `workflow_dispatch` (nunca em pushes comuns na branch principal), mantendo o ambiente estável durante avaliações |
| Licenciamento | MIT |

---

## 10. Estratégia de Qualidade e CI/CD (GitHub Actions)

- **Pre-commit e Pre-push local:** ESLint (com `no-restricted-imports` garantindo fronteira hexagonal e `no-floating-promises`), Prettier, typecheck e testes (`pnpm run check:workspace`).
- **Workflows no Monorepo Principal (`zeromttr/.github/workflows/`):**
  1. **`ci.yml` (Integração Contínua em Push e PRs):**
     - **Quality & Security Gate:** ESLint, Prettier, `tsc --noEmit`, varredura de segredos (`gitleaks-action`) e `pnpm audit --prod --audit-level=critical`.
     - **Unit, Security & Contract Tests + Coverage Gate:** Vitest com cobertura ≥ 80 % em `domain/` + `application/` (incluindo o teste obrigatório do `PiiPromptGuard` provando zero CPF/CNPJ/PIX/JWT no prompt enviado ao `ReasoningPort`).
     - **Docker & Compose Smoke Test:** valida `docker compose config` e build das imagens.
  2. **`cd-release.yml` (Publicação GHCR & Deploy Controlado na VPS):**
     - Publica imagens no **GitHub Container Registry (`ghcr.io/admilsongoncalves/zeromttr/*`)**.
     - O job `deploy-vps` executa **somente quando uma tag `v*.*.*` é criada ou via `workflow_dispatch` manual**, evitando que commits intermediários derrubem ou reiniciem a VPS durante o período de avaliação.
- **Workflow no Repositório Alvo (`zeromttr-target-pix-freight/.github/workflows/`):**
  3. **`hotfix-verify.yml` (Validação Automática dos PRs Autônomos):**
     - Dispara nos Pull Requests `hotfix/zeromttr-*` abertos pelo ZeroMTTR no repositório-alvo, executa o teste de concorrência/liberação de pool do `PixSettlementRepository` e publica o comentário de certificação (`✅ ZeroMTTR Autonomous CI Gate: PASSED`).

---

## 11. Riscos Técnicos e Mitigações

| # | Risco | Prob. | Impacto | Mitigação |
| :--- | :--- | :--- | :--- | :--- |
| R1 | Indisponibilidade, timeout ou deprecação de modelo na API do LLM | Baixa | Alto | Modelo configurável via env (`LLM_MODEL=gemini-2.0-flash`); fallback determinístico que executa a sequência de tools MCP e aplica o patch de referência caso a API do LLM falhe |
| R2 | Visitante anônimo tentar aprovar incidente ou esgotar cotas na VPS pública | Média | Alto | `decisionToken` removido do SSE/REST (enviado só por e-mail); modo `replay` como padrão para visitantes sem `LIVE_DEMO_KEY`; cooldown global de 2 min |
| R3 | Processor `redaction` não cobrir corpo de logs (`log.body`) no Collector | Média | Alto | Uso explícito do processor **`transform` (OTTL `replace_pattern` sobre `log.body`)** combinado com auditoria determinística no **`PiiPromptGuard`** antes do `ReasoningPort` |
| R4 | Poluição do repositório principal por branches/PRs de teste | Média | Médio | Repositório-alvo separado (`zeromttr-target-pix-freight`) com tags reais `v2.14.7`/`v2.14.8` e limpeza automatizada via `scripts/reset.sh` |
| R5 | OOMKill em serviços da stack LGTM na VPS durante consultas concorrentes | Baixa | Médio | Limites dimensionados com margem segura (`prometheus: 512M`, `loki: 512M`, `tempo: 384M`, Collector `256M` com `limit_mib: 200`) validados sob carga na Fase 5 |

---

## 12. Mapa dos Documentos Técnicos (Fatias para Agentes de IA)

Cada documento é **autocontido** e termina com tarefas e critérios de aceite verificáveis. Ordem de execução recomendada:

| # | Documento | Fase | Depende de |
| :--- | :--- | :--- | :--- |
| 01 | [tech/01_foundation_and_infrastructure.md](./tech/01_foundation_and_infrastructure.md) | 1 | — |
| 02 | [tech/02_mcp_server.md](./tech/02_mcp_server.md) | 2 | 01 |
| 03 | [tech/03_target_app_demo.md](./tech/03_target_app_demo.md) | 3 | 01 |
| 04 | [tech/04_partner_integrations.md](./tech/04_partner_integrations.md) | 2 e 4 | 02 |
| 05 | [tech/05_orchestrator.md](./tech/05_orchestrator.md) | 4 | 02, 03, 04 |
| 06 | [tech/06_testing_and_quality.md](./tech/06_testing_and_quality.md) | todas | — |
| 07 | [tech/07_demo_and_delivery.md](./tech/07_demo_and_delivery.md) | 5–6 | 05, 08 |
| 08 | [tech/08_dashboard_frontend.md](./tech/08_dashboard_frontend.md) | 4b | contrato da §4 (mock) ; integra com 05 |

> [!TIP]
> Prompt padrão para agentes: *"Leia `AGENTS.md`, `docs/pt-BR/00_architecture_master.md` e `docs/pt-BR/tech/NN_*.md`. Implemente somente esse documento, do zero e em TDD, e pare quando todos os critérios de aceite estiverem verdes."*

---

## 13. Glossário
- **ADR:** *Architecture Decision Record* (registro de decisão arquitetural)
- **AIOps:** *Artificial Intelligence for IT Operations* (inteligência artificial para operações de TI)
- **CI/CD:** *Continuous Integration / Continuous Delivery* (integração contínua e entrega contínua)
- **CNPJ:** *Cadastro Nacional da Pessoa Jurídica* (*Brazilian Corporate Taxpayer Registry* — identificador fiscal de empresas no Brasil)
- **CPF:** *Cadastro de Pessoas Físicas* (*Brazilian Individual Taxpayer Registry* — identificador fiscal pessoal no Brasil)
- **CVE:** *Common Vulnerabilities and Exposures* (catálogo de vulnerabilidades e exposições de segurança conhecidas)
- **DoD:** *Definition of Done* (definição de pronto)
- **DRY:** *Don't Repeat Yourself* (princípio de não duplicação de conhecimento/código)
- **E2E:** *End-to-End* (teste ou fluxo de ponta a ponta)
- **FinOps:** *Financial Operations* (gestão financeira operacional de nuvem, infraestrutura e consumo de tokens de IA)
- **FSM:** *Finite State Machine* (máquina de estados finitos)
- **GHCR:** *GitHub Container Registry* (registro de imagens de contêineres do GitHub)
- **HMAC:** *Hash-based Message Authentication Code* (código de autenticação de mensagem baseado em hash criptográfico)
- **JWT:** *JSON Web Token* (padrão de token de autenticação assinado em JSON)
- **KISS:** *Keep It Simple, Stupid* (princípio de manter o design o mais simples possível)
- **KPI:** *Key Performance Indicator* (indicador-chave de desempenho)
- **LGPD:** *Lei Geral de Proteção de Dados* (*Brazilian General Data Protection Law* — legislação brasileira de privacidade de dados)
- **LGTM:** *Loki, Grafana, Tempo, Metrics / Mimir* (pilha de observabilidade de logs, visualização, traces e métricas)
- **LLM:** *Large Language Model* (grande modelo de linguagem)
- **LogQL:** *Log Query Language* (linguagem de consulta de logs do Grafana Loki)
- **MCP:** *Model Context Protocol* (protocolo aberto de contexto de modelo para integração de ferramentas com agentes de IA)
- **MTTD:** *Mean Time to Detect* (tempo médio de detecção de um incidente)
- **MTTR:** *Mean Time to Resolve / Recovery* (tempo médio de resolução ou recuperação de um incidente)
- **MVC:** *Model-View-Controller* (padrão arquitetural em camadas de modelo, visualização e controlador)
- **MVP:** *Minimum Viable Product* (produto mínimo viável)
- **OTel:** *OpenTelemetry* (framework e padrão aberto de instrumentação e telemetria)
- **OTLP:** *OpenTelemetry Protocol* (protocolo nativo de transporte de dados do OpenTelemetry)
- **OTTL:** *OpenTelemetry Transformation Language* (linguagem de transformação de telemetria usada pelo processor `transform` do OTel Collector)
- **PAT:** *Personal Access Token* (token de acesso pessoal para autenticação na API do GitHub)
- **PII:** *Personally Identifiable Information* (informação pessoalmente identificável / dados pessoais sensíveis)
- **PIX:** *Pagamento Instantâneo Brasileiro* (sistema de pagamentos instantâneos do Banco Central do Brasil)
- **PR:** *Pull Request* (solicitação de revisão e mesclagem de alterações de código)
- **PromQL:** *Prometheus Query Language* (linguagem de consulta de séries temporais do Prometheus)
- **RCA:** *Root Cause Analysis* (análise de causa raiz de um incidente)
- **SOLID:** *Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, Dependency Inversion* (cinco princípios de design de código limpo e desacoplado)
- **SPA:** *Single-Page Application* (aplicação web de página única)
- **SRE:** *Site Reliability Engineering / Engineer* (engenharia ou engenheiro de confiabilidade de sistemas)
- **SRP:** *Single Responsibility Principle* (princípio da responsabilidade única)
- **SSE:** *Server-Sent Events* (eventos enviados pelo servidor ao navegador em tempo real via HTTP)
- **TDD:** *Test-Driven Development* (desenvolvimento orientado a testes)
- **TraceQL:** *Trace Query Language* (linguagem de consulta de traces distribuídos do Grafana Tempo)
- **TTD:** *Time to Deterministic Diagnosis* (tempo decorrido do alerta até o isolamento determinístico da causa raiz e do diff de deploy)
- **TTL:** *Time to Live* (tempo de vida útil de um registro em cache ou token)
- **TTPR:** *Time to Reviewable Pull Request* (tempo decorrido do alerta até a abertura de um Pull Request de hotfix validado por CI)
- **VPS:** *Virtual Private Server* (servidor virtual privado)
- **YAGNI:** *You Aren't Gonna Need It* (princípio de não implementar funcionalidades não requisitadas no momento)
