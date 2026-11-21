# ⚡ ZeroMTTR — AIOps Autônomo e Remediação de Incidentes

> **Read in English:** [README.md](./README.md)  
> **Trilha:** Logística & Automação (_Automação de fluxos operacionais e integração entre sistemas críticos_)  
> **Organização:** AGJ Works ([https://agjworks.com](https://agjworks.com))  
> **Repositório:** [https://github.com/AdmilsonGoncalves/zeromttr](https://github.com/AdmilsonGoncalves/zeromttr)  
> **Ambiente de Demonstração:** [https://zeromttr.agjworks.com](https://zeromttr.agjworks.com)

---

## 1. Visão Geral e Posicionamento

Em sistemas distribuídos de missão crítica — como liquidação de pagamentos instantâneos (PIX), separação e expedição logística, checkout ou faturamento — o tempo entre o disparo de um alerta e um hotfix revisável ainda é dominado por trabalho manual fragmentado entre métricas, traces, logs e diffs no Git.

O **ZeroMTTR** é uma plataforma autônoma de AIOps e remediação de incidentes inscrita na trilha **Logística & Automação** (automação de fluxos de trabalho operacionais e integração entre sistemas críticos). Seu núcleo adota **Clean Architecture / Arquitetura Hexagonal** e é **100% agnóstico ao domínio**: qualquer serviço que emita telemetria OpenTelemetry (OTLP) e possua um repositório hospedado no **GitHub** (outros provedores Git como GitLab podem ser suportados implementando um adapter para `RepoInspectorPort` / `RemediationPort`) pode ser diagnosticado e remediado sem alterar uma única linha em `apps/orchestrator` ou `apps/mcp-server`.

### Tabela Comparativa Qualificada (referência: novembro/2026)

| Capacidade                          | HolmesGPT / OpenSRE                                    | Datadog Bits AI / Sentry Seer                | ZeroMTTR                                                                                                                                                  |
| :---------------------------------- | :----------------------------------------------------- | :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implantação e Protocolo**         | Self-hosted (CLI / ChatOps)                            | SaaS proprietário em nuvem                   | **100% Self-Hosted & Open Source** expondo contrato aberto **Model Context Protocol (MCP)** sobre Streamable HTTP (8 tools + `.mcp.json`)                 |
| **Proteção de PII na Borda (LGPD)** | Sem pipeline nativo de borda para PII brasileira / PIX | Telemetria processada na nuvem do fornecedor | **Dupla barreira:** mascaramento OTTL `transform` no OTel Collector antes do Loki + **`PiiPromptGuard` (fail-closed)** antes do envio ao LLM              |
| **Telemetria FinOps de Payload**    | Dumps brutos de contexto                               | Cobrança gerenciada no SaaS                  | Sumarização determinística e truncamento de política no MCP com rastreamento `raw` vs. `compacted` por incidente e estimativa de tokens poupados          |
| **Governança de Remediação**        | Scripts ou sugestões via ChatOps                       | PR / sugestões proprietárias                 | **Pull Request de hotfix** contra branch de release + **CI Gate (`hotfix-verify.yml`)** + **aprovação humana via HMAC enviada exclusivamente por e-mail** |
| **Resiliência sem LLM**             | Dependente do LLM configurado                          | Dependente do SaaS                           | `ReasoningPort` explícito com **fallback determinístico** (`reasoningSource: 'llm' \| 'fallback'`)                                                        |

---

## 2. Arquitetura e Fluxo Autônomo

```text
Alerta Grafana (Webhook, GRAFANA_WEBHOOK_TOKEN)
  ──> Orchestrator (FSM: RECEIVED -> INVESTIGATING -> ENRICHING -> REMEDIATING -> AWAITING_PR -> NOTIFIED -> RESOLVED/REJECTED)
  <──> MCP Server (8 Tools sobre Streamable HTTP: PromQL, Tempo, Loki, GitHub Diff/PR, Resend, Grafana Annotations)
  <──> Gemini LLM (via ReasoningPort auditado pelo PiiPromptGuard fail-closed + fallback determinístico)
  ──> Pull Request de Hotfix no GitHub (contra release/target-v2.14.8 + CI Gate hotfix-verify.yml)
  ──> E-mail Post-Mortem via Resend (link de decisão HMAC exclusivamente no #fragment)
  ──> Stream SSE em tempo real para o War Room Dashboard (Angular)
```

---

## 3. Transparência Técnica e Limites do MVP

Para uma avaliação honesta e auditável, o ZeroMTTR explicita os limites atuais do MVP:

1. **Modo `Live` vs. Modo `Replay` na demonstração pública (`https://zeromttr.agjworks.com`):**
   - Visitantes anônimos na URL pública visualizam por padrão o **Modo `Replay`**, que reproduz fielmente um snapshot gravado de uma execução real (`data/last-recorded-incident.json`) para proteger as cotas externas de LLM, GitHub e e-mail.
   - Para testar o **Modo `Live`** ponta a ponta (raciocínio real no Gemini, PR real no GitHub e e-mail real via Resend), execute localmente com `docker compose up -d` usando suas chaves no `.env`, ou desbloqueie o modo `Live` na instância pública com a chave **`LIVE_DEMO_KEY`** (dedicada à avaliação e rotacionada imediatamente após o encerramento).
2. **Fronteira de Governança — Pull Request verificado por CI + Decisão Humana (sem auto-merge/redeploy):**
   - O ciclo autônomo encerra propositalmente na abertura do **Pull Request de hotfix validado por CI** (`.github/workflows/hotfix-verify.yml`) e no registro da **decisão humana assinada criptograficamente** (`approve` / `reject` via link HMAC no `#fragment` enviado exclusivamente por e-mail).
   - O ZeroMTTR **não** realiza merge automático na `master` nem redeploy automático no contêiner em execução.
3. **Escopo da Métrica FinOps e do Mascaramento de PII:**
   - **Métrica FinOps:** mede a **redução de payload obtida por sumarização e truncamento de política** no servidor MCP (`rawBytesFetched` vs. `compactedBytesSentToLlm`), usando estimativa proporcional conservadora de `Math.round(bytesSaved / 4)` tokens (não uma contagem proprietária de tokenizador).
   - **Mascaramento de PII:** cobre os **5 tipos oficiais de Chave PIX do Banco Central (BACEN)** — **CPF** e **CNPJ** (validados por dígito verificador Módulo-11 da Receita Federal), **telefone celular/fixo** (regras da ANATEL), **e-mail no formato padrão sem aspas** (`[A-Za-z0-9._%+-]+@domínio`, não cobrindo _quoted local parts_ como endereços com espaços) e **chave aleatória EVP (UUID v4 RFC 4122 em contexto PIX)** — além de **tokens JWT / `Bearer`**. UUIDs técnicos (como `request_id` e `trace_id`), _quoted local parts_ de e-mail e nomes próprios em texto livre ficam intencionalmente fora do escopo determinístico.

---

## 4. Como Conectar um Cliente MCP Externo (`.mcp.json`)

O `apps/mcp-server` implementa o padrão **Model Context Protocol (MCP)** sobre Streamable HTTP (`POST /mcp`). Qualquer cliente compatível (**MCP Inspector**, **Claude Code**, **Claude Desktop**, **Cursor**) pode se conectar diretamente. O arquivo [`.mcp.json`](./.mcp.json) na raiz fornece a configuração base:

```json
{
  "mcpServers": {
    "zeromttr-aiops": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

> **Nota para usuários do Cursor:** O Cursor lê configurações MCP de projeto em `.cursor/mcp.json` (não descobre automaticamente o `.mcp.json` da raiz) e utiliza `${env:MCP_AUTH_TOKEN}` para interpolação de variáveis de ambiente:
>
> ```json
> {
>   "mcpServers": {
>     "zeromttr-aiops": {
>       "url": "http://localhost:8000/mcp",
>       "headers": {
>         "Authorization": "Bearer ${env:MCP_AUTH_TOKEN}"
>       }
>     }
>   }
> }
> ```
>
> Certifique-se de exportar `MCP_AUTH_TOKEN` no ambiente do processo do cliente MCP — apenas copiar o arquivo `.env` não exporta a variável automaticamente.

### Ferramentas MCP Expostas (8)

| Categoria       | Ferramenta                  | Finalidade                                                                  |
| :-------------- | :-------------------------- | :-------------------------------------------------------------------------- |
| Métricas        | `execute_promql_range`      | Consulta séries temporais no Prometheus e retorna estatísticas sumarizadas  |
| Traces          | `search_traces_by_traceql`  | Busca traces anômalos no Tempo via TraceQL                                  |
| Traces          | `analyze_otel_trace`        | Extrai o caminho crítico e spans em erro de um `traceId`                    |
| Logs            | `query_loki_logs`           | Consulta logs mascarados na borda no Loki com truncamento de política       |
| Código          | `inspect_git_deploy_diff`   | Inspeciona o diff real no GitHub entre a tag saudável e a tag degradada     |
| Remediação      | `create_remediation_pr`     | Cria branch `hotfix/*` e abre Pull Request contra a branch de release       |
| Notificação     | `send_post_mortem_resend`   | Envia e-mail post-mortem com links de decisão HMAC no `#fragment`           |
| Observabilidade | `annotate_grafana_incident` | Publica anotações do ciclo do incidente diretamente nos gráficos do Grafana |

Teste rápido com o MCP Inspector (após subir a stack local):

```bash
export MCP_AUTH_TOKEN="$(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2-)"
npx @modelcontextprotocol/inspector
# Conectar via Streamable HTTP em http://localhost:8000/mcp com o header:
# Authorization: Bearer <MCP_AUTH_TOKEN>
```

---

## 5. Cenário Determinístico de Demonstração (`v2.14.7` vs. `v2.14.8`)

Para reproduzir Pull Requests reais de forma determinística sem jamais comprometer a `master`:

- **Tag `v2.14.7` (na `master`):** versão saudável de `apps/target-app-demo` (`api-pagamentos-core`) com pool de conexões dimensionado corretamente. A `master` permanece sempre verde.
- **Tag `v2.14.8` (na branch `release/target-v2.14.8`):** regressão controlada em `apps/target-app-demo/src/repositories/payment.repository.ts` que provoca exaustão do pool (`KnexTimeoutError`).
- Ao detectar o incidente, o ZeroMTTR inspeciona o diff real `v2.14.7...v2.14.8`, gera o patch mínimo de correção, abre um Pull Request contra **`release/target-v2.14.8`** e aciona o workflow [`.github/workflows/hotfix-verify.yml`](./.github/workflows/hotfix-verify.yml), que executa a suíte de testes e comenta `✅ ZeroMTTR Autonomous CI Gate: PASSED`.

---

## 6. Baseline Medido (TTD / TTPR e Estabilidade LGTM)

A metodologia completa e os resultados brutos estão documentados em [docs/pt-BR/phase-5-baseline.md](./docs/pt-BR/phase-5-baseline.md).

Em comparação ao baseline manual de 7 etapas (1. triagem do alerta → 2. consulta PromQL → 3. inspeção de exemplar/trace no Tempo → 4. correlação de logs no Loki → 5. `git diff v2.14.7...v2.14.8` → 6. edição e testes do fix → 7. abertura de PR e redação do post-mortem):

| Modo de Execução                                                        | TTD (`RECEIVED -> REMEDIATING`) | TTPR (`RECEIVED -> AWAITING_PR`) | Post-Mortem (`RECEIVED -> NOTIFIED`)                   | Redução FinOps                 | PII Guard      |
| :---------------------------------------------------------------------- | :------------------------------ | :------------------------------- | :----------------------------------------------------- | :----------------------------- | :------------- |
| **Replay dourado** (`inc-live-demo-golden-1795134557970-1`)             | `11.51s` (meta `<= 15s`)        | `14.51s` (meta `<= 30s`)         | `19.51s` (meta `<= 45s`)                               | `94%` (`11.328` tokens est.)   | `passed: true` |
| **Live LGTM local** (`inc-d7a8aa3e`, modo fallback sem chaves externas) | `1.03s` (meta `<= 15s`)         | `1.06s` (meta `<= 30s`)          | `n/a` (interrompido em `401` no PR sem `GITHUB_TOKEN`) | `66.14%` (`5.014` tokens est.) | `passed: true` |

- **Estabilidade LGTM sob carga (`./scripts/load-test-lgtm.sh`):** `1.462` observações de histograma Prometheus em 9 buckets, `zeromttr-otel-collector` estável em `91.77 MiB` (`GOMEMLIMIT=200MiB`) e memória agregada dos 10 contêineres em `986.8 MiB` (`<= 2.200 MiB`, zero OOMKills).
- **Vídeo de Demonstração Live (3 min, en-US):** _Aguardando gravação final em modo Live (roteiro detalhado em [07_demo_and_delivery.md](./docs/pt-BR/tech/07_demo_and_delivery.md) §1)._

---

## 7. Desenvolvimento Local e Execução

### Pré-requisitos

- Node.js 24 LTS (`.nvmrc`)
- pnpm 10+ (`packageManager`)
- Docker & Docker Compose v2.40+

### Inicialização e Verificação

```bash
# 1. Clonar e configurar variáveis de ambiente
cp .env.example .env

# 2. Instalar dependências com lockfile congelado
pnpm install --frozen-lockfile

# 3. Executar a checagem completa de qualidade (Prettier, ESLint, typecheck, testes, build)
pnpm run check:workspace

# 4. Subir toda a stack local (LGTM + OTel Collector + aplicações)
docker compose up -d --build
```

Endpoints locais:

- **War Room Dashboard:** [http://localhost:4200](http://localhost:4200)
- **Grafana:** [http://localhost:3000](http://localhost:3000)
- **Prometheus:** [http://localhost:9090](http://localhost:9090)
- **Servidor MCP:** `http://localhost:8000/mcp`
- **OTel Collector:** OTLP gRPC `4317` / HTTP `4318`

---

## 8. Documentação

- [Documento Mestre de Arquitetura](./docs/pt-BR/00_architecture_master.md)
- [Diagramas Comportamentais e de Rede](./docs/pt-BR/01_system_diagrams.md)
- [Architecture Decision Records — ADRs 001–009](./docs/pt-BR/adr/README.md)
- [Baseline e Medições da Fase 5](./docs/pt-BR/phase-5-baseline.md)
- [Especificações Técnicas (`docs/pt-BR/tech/`)](./docs/pt-BR/tech/)
- [Guia de Contribuição (`CONTRIBUTING.md`)](./CONTRIBUTING.md)
- [Política de Segurança (`SECURITY.md`)](./SECURITY.md)
- [Instruções para Agentes (`AGENTS.md`)](./AGENTS.md)

---

## 9. Licença

MIT License — Copyright (c) 2026 AGJ Works. Consulte [LICENSE](./LICENSE).
