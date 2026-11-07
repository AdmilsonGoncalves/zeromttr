# TECH 01 — Fundação, Sanitização OTTL e Infraestrutura (Fase 1)

**Pré-requisito de leitura:** `AGENTS.md`, [00_architecture_master.md](../00_architecture_master.md), [01_system_diagrams.md](../01_system_diagrams.md)
**Objetivo:** estruturar o monorepo do zero com `pnpm` + `Nx`, configurar a pipeline de CI/CD e subir a stack LGTM saudável via `docker compose up` com mascaramento determinístico de PII via OTTL (`transform`).

## 1. Escopo
Estrutura de pastas, tooling de qualidade, configurações da stack de observabilidade (`infra/`) e workflows de CI/CD. Toda a implementação deve ser escrita do zero a partir desta especificação.

## 2. Tarefas

### T1.1 Esqueleto do Monorepo (`pnpm` + `Nx` em `apps/*`)
Criar a estrutura definida na §7 do documento mestre:
- **Gerenciador de pacotes:** **pnpm** (`packageManager: "pnpm@10.x"` no `package.json` raiz via Corepack) + `pnpm-workspace.yaml` com `packages: ['apps/*']` (`apps/mcp-server`, `apps/orchestrator`, `apps/target-app-demo`, `apps/dashboard`).
- **Orquestrador de monorepo:** **Nx (Package-Based)** com `nx.json` enxuto na raiz configurando `targetDefaults` (`build`, `lint`, `typecheck`, `test` com cache local habilitado).
- **TypeScript & Runtime:** `tsconfig.base.json` na raiz (`strict`, `ES2024`, `NodeNext`), Node 24 em `.nvmrc` e `engines` (`>=24.0.0`).
- **`.dockerignore` na raiz:** ignorar `node_modules/`, `.nx/`, `dist/`, `coverage/`, `.git/` e `docs/` para manter o contexto de build Docker (`context: .`) abaixo de 2 MB.

### T1.2 Tooling de Qualidade & Scripts Enxutos (`*:workspace`)
ESLint (flat config `eslint.config.mjs`) + Prettier + Husky (`pre-commit` com `lint-staged` e `pre-push` rodando `pnpm run check:workspace`) + Commitlint (Conventional Commits).
- **Regras obrigatórias no `eslint.config.mjs` raiz:**
  1. **Fronteira Hexagonal (`no-restricted-imports`):** arquivos em `apps/{mcp-server,orchestrator}/src/{domain,application}/**/*.ts` são proibidos de importar `../adapters/**`, `../transport/**`, `../http/**`, `express`, `axios` ou `@modelcontextprotocol/sdk`.
  2. **Segurança Assíncrona:** `@typescript-eslint/no-floating-promises` e `@typescript-eslint/no-misused-promises` habilitados.
- **Scripts enxutos no `package.json` da raiz (apenas os 4 essenciais com sintaxe moderna do Nx 20):**
  ```json
  {
    "scripts": {
      "check:workspace": "prettier --check . && nx run-many -t lint,typecheck,test,build --parallel=4",
      "lint:workspace": "nx run-many -t lint",
      "test:workspace": "nx run-many -t test",
      "build:workspace": "nx run-many -t build"
    }
  }
  ```

### T1.3 Infraestrutura de Observabilidade em `infra/` e Mascaramento OTTL (`transform`)
Criar os arquivos de configuração da stack LGTM e do OpenTelemetry Collector em `infra/`:

| Arquivo | Requisito Técnico |
| :--- | :--- |
| `datasources.yaml` | Configurar Prometheus (`uid: prometheus-datasource` com `exemplarTraceIdDestinations` apontando para o Tempo), Loki (com `derivedFields` extraindo `trace_id`) e Tempo (`tracesToMetrics` e `tracesToLogs`). |
| `docker-compose.yml` | Ambiente local com healthchecks para Prometheus (iniciado obrigatoriamente com `--config.file=/etc/prometheus/prometheus.yml --web.enable-remote-write-receiver --enable-feature=exemplar-storage` para reter exemplars de `trace_id`), Loki, Tempo, Grafana e PostgreSQL; incluir serviços `mcp-server`, `orchestrator`, `target-app-demo` (`api-pagamentos-core`) e `dashboard` (porta `4200:80` e `NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$`). |
| `otel-collector-config.yaml` | **Mascaramento de PII em Logs via `transform` (OTTL) + Mapeamento de `service` no Loki:** configurar obrigatoriamente o processor **`transform`** no pipeline de `logs` usando funções OTTL `replace_pattern(log.body, ...)` e `replace_all_patterns(log.attributes, "value", ...)` para mascarar deterministicamente **CPF**, **CNPJ**, **Chave PIX / E-mail** e tokens **Bearer / JWT** antes da exportação para o Loki, além de mapear `resource.attributes["service.name"]` para o label de stream `service` no Loki (ver §3.2). |
| `tempo-config.yaml` | Receptor OTLP gRPC (`4317`) e HTTP (`4318`) com busca TraceQL habilitada. |

### T1.4 Alerting Provisionado com Token Segregado
Criar `infra/grafana/provisioning/alerting/`:
- `contact-points.yaml`: webhook apontando para `http://orchestrator:8080/webhook/grafana-alert` autenticado com cabeçalho `Authorization: Bearer ${GRAFANA_WEBHOOK_TOKEN}` (token exclusivo do Grafana, separado do token do Dashboard; garantir que a variável `GRAFANA_WEBHOOK_TOKEN` seja injetada no bloco `environment:` tanto do contêiner `grafana` quanto do `orchestrator` nos arquivos `docker-compose.yml` e `docker-compose.prod.yml`).
- `rules.yaml`: regra de alta latência p95 / saturação de conexões sobre as métricas de `api-pagamentos-core`, `for: 30s`, labels `service=api-pagamentos-core`, `severity=critical`.
- `policies.yaml`: rota padrão vinculada ao contact point.

### T1.5 CI/CD com GitHub Actions (`.github/workflows/`)
Criar os 3 workflows em `.github/workflows/`:
1. **`ci.yml`:** Node 24 + `pnpm/action-setup@v4`, `pnpm install --frozen-lockfile`, lint, typecheck, `gitleaks`, testes de integração (Happy/Unhappy Paths) e de funções de apoio com `vitest --coverage` (thresholds ≥ 80 % em `domain/` e `application/`, bloqueante) via Nx, `prettier --check .`, build, `pnpm audit --prod --audit-level=critical` (bloqueante para vulnerabilidades críticas) e smoke test do `docker compose config`.
2. **`hotfix-verify.yml`:** dispara nos Pull Requests de branches `hotfix/zeromttr-*` abertos pelo ZeroMTTR (mirando `release/target-v2.14.8`), executa a suíte de testes de regressão do `apps/target-app-demo` e publica o comentário de certificação (`✅ ZeroMTTR Autonomous CI Gate: PASSED`) no PR.
3. **`cd-release.yml`:** publica as imagens Docker no **GitHub Container Registry (`ghcr.io/admilsongoncalves/zeromttr/*`)**. **Regra de estabilidade operacional:** o job `deploy-vps` **não** executa a cada push na branch principal nem nas tags de comparação do workload de demo (`v2.14.*`); ele roda **exclusivamente quando uma tag de release da plataforma `v1.*.*` é publicada ou por acionamento manual (`workflow_dispatch`)**, mantendo a VPS de demonstração congelada e estável durante períodos de avaliação.

### T1.6 Documentação Inicial
`README.md` (en-US) e `README.pt-BR.md` declarando a trilha (**Logística & Automação** — automação de fluxos de trabalho e integração entre sistemas), a arquitetura aberta e agnóstica de domínio, o posicionamento técnico frente ao mercado, instruções de execução local e distinção clara entre modo `Live` e modo `Replay`. Criar `LICENSE` (MIT), `.env.example`, `AGENTS.md` (especificação abaixo) e `GEMINI.md` (apenas um ponteiro com a instrução de ler e seguir o `AGENTS.md`, já criado na raiz).

#### Especificação do `AGENTS.md` (raiz do repositório)
Arquivo curto, imperativo e escrito em português, lido por todo agente de codificação antes de qualquer implementação. Deve conter as seções obrigatórias abaixo:

1. **Contexto e Ordem de Leitura:** o que é o ZeroMTTR (trilha Logística & Automação, domínio agnóstico, monorepo único `AdmilsonGoncalves/zeromttr`) e a ordem de leitura: `00_architecture_master.md` → `01_system_diagrams.md` → `tech/NN_*.md` da tarefa. Regra: implementar **somente** o documento `tech/NN` atribuído e parar quando todos os critérios de aceite estiverem verdes.
2. **Comandos Essenciais:** `pnpm install --frozen-lockfile`, `pnpm run check:workspace`, `pnpm nx test <app>`, `pnpm nx run-many -t typecheck`, `docker compose up -d`.
3. **Arquitetura e Fronteiras:**
   - `apps/orchestrator` e `apps/mcp-server`: Hexagonal (`domain` → `application` → `ports` → `adapters`, composition root em `main.ts`); o domínio **nunca** importa adapters ou frameworks (imposto por ESLint `no-restricted-imports`).
   - `apps/target-app-demo`: MVC em camadas (`routes` → `controllers` → `services` → `repositories`).
   - `apps/dashboard`: Angular standalone com Signals (`WarRoomComponent` + `DecisionComponent`).
   - O núcleo permanece agnóstico: nenhuma regra de negócio do `api-pagamentos-core` pode vazar para o orquestrador ou o MCP.
4. **Estratégia de Testes (ver [tech/06](./06_testing_and_quality.md)):**
   - *Testing Trophy*: integração e E2E primeiro; testes unitários apenas para funções puras de apoio.
   - Criar os helpers em `test/helpers/` **antes** das suítes, sem repetir chamadas HTTP.
   - Escrever os *Happy Paths* e *Unhappy Paths* **antes** do código (Red → Green → Refactor), com tabelas `it.each` para regexes e validações.
   - Nomear testes pelo comportamento (`should_...`).
   - **Proibido** chamar APIs externas reais (Gemini, GitHub, Resend) na suíte automatizada.
5. **Regras de Segurança Inegociáveis:**
   - Nunca commitar segredos, `.env` ou `docs/apoio/`.
   - Nunca expor `sig`/`approveSig`/`rejectSig` em SSE ou REST (apenas no e-mail, via `#fragment`).
   - Manter os 3 tokens segregados (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`).
   - Nunca usar PII real (CPF, CNPJ, telefone, e-mail, chaves PIX) em logs, fixtures, prompts ou documentação; apenas dados sintéticos.
   - O `PiiPromptGuard` opera sempre em modo *fail-closed*.
6. **Regras de Git:**
   - Conventional Commits (Commitlint).
   - **Nunca executar `git commit` ou `git push` sem ordem explícita do usuário.**
   - Nunca fazer push direto na `master` (usar branch + PR).
   - Nunca fazer `git push --force`.
7. **Regras do Cenário de Demonstração:**
   - As tags `v2.14.7` e `v2.14.8` e a branch `release/target-v2.14.8` só são criadas ao final da Fase 3, após `hotfix-verify.yml`, `pnpm-lock.yaml` e `payment-pool.spec.ts` existirem na `master`.
   - Tags `v2.14.*` jamais disparam deploy; apenas tags `v1.*.*` ou `workflow_dispatch` acionam o `deploy-vps`.
   - A `master` permanece sempre saudável (`v2.14.7`); a regressão vive apenas em `release/target-v2.14.8`.
8. **Definition of Done:** checklist de [tech/06 §6](./06_testing_and_quality.md) (helpers sem duplicação, testes de integração *Happy*/*Unhappy* verdes, `pnpm run check:workspace` 100% verde, sem segredos nem PII, critérios de aceite do `tech/NN` cumpridos).

### T1.7 Configuração de Deploy Blindado na VPS (`docker-compose.prod.yml` + Segregação de Tokens)
Criar `docker-compose.prod.yml`, `infra/otel-collector-config.prod.yaml` e `apps/dashboard/nginx.conf.template`:
- **Segredos externos ao repositório** (ex.: `/path/to/secrets/.env` com permissão `600`), referenciados via `${ENV_FILE_PATH}`.
- **Zero portas publicadas no host (`expose:` apenas):** todos os serviços de telemetria e backend ficam isolados na rede `aiops-net`.
- **Segregação de tokens no Nginx:** o container `dashboard` (Nginx) injeta `Authorization: Bearer ${DASHBOARD_API_TOKEN}` nas rotas `/api/*` do Dashboard. O token `GRAFANA_WEBHOOK_TOKEN` nunca passa pelo Nginx.
- **Limites de RAM dimensionados com margem contra OOMKill sob carga (~2.1 GB total):** `prometheus: 512M`, `loki: 512M`, `tempo: 384M`, `otel-collector: 256M` (`limit_mib: 200`), `grafana: 256M`, `orchestrator: 256M`, `mcp-server: 192M`, `target-app-demo: 192M`, `postgres: 192M`, `dashboard: 128M`.

---

## 3. Variáveis de Ambiente (`.env.example` / `.env.prod.template`)
> **Regra de formatação:** nunca usar comentários *inline* na mesma linha do valor e sempre envolver valores com espaços ou `< >` em aspas duplas.

```dotenv
# VPS / Traefik / Grafana Admin (AGJ Works)
ZEROMTTR_DOMAIN=zeromttr.agjworks.com
TRAEFIK_NETWORK_NAME=traefik_default
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=change-me-strong-password

# Observability (rede interna Docker aiops-net)
PROMETHEUS_URL=http://prometheus:9090
LOKI_URL=http://loki:3100
TEMPO_URL=http://tempo:3200
GRAFANA_URL=http://grafana:3000
GRAFANA_SA_TOKEN=

# Segregação de Tokens (Menor Privilégio)
MCP_AUTH_TOKEN=change-me-mcp-token
GRAFANA_WEBHOOK_TOKEN=change-me-grafana-webhook-token
DASHBOARD_API_TOKEN=change-me-dashboard-api-token
# Assina exclusivamente os links de Aprovar/Rejeitar enviados por e-mail
DECISION_HMAC_SECRET=change-me-hmac-secret
# Chave exigida na VPS pública para acionar modo Live real (protege cota contra tráfego anônimo)
LIVE_DEMO_KEY=
SIMULATION_COOLDOWN_MS=120000
PUBLIC_BASE_URL=http://localhost:8080
PUBLIC_DASHBOARD_URL=http://localhost:4200

# Orchestrator -> MCP & Demo Workload
MCP_URL=http://mcp-server:8000
TARGET_DEMO_URL=http://target-app-demo:3001
DATABASE_URL=postgres://zeromttr:zeromttr@postgres:5432/payments

# External Integrations (GitHub API & Resend)
GITHUB_TOKEN=
TARGET_GITHUB_REPO=https://github.com/AdmilsonGoncalves/zeromttr
TARGET_BASE_BRANCH=release/target-v2.14.8
TARGET_SERVICE_PATH=apps/target-app-demo
RESEND_API_KEY=
RESEND_FROM="ZeroMTTR - AGJ Works <sre@send.zeromttr.agjworks.com>"
ON_CALL_ENGINEER_EMAIL=oncall-sre@example.com

# LLM (Orchestrator ReasoningPort — Modelo Parametrizável)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash
LLM_API_KEY=

# Flags do Workload
CHAOS_ENABLED=true
DEMO_MODE=true
```

---

### 3.1 Especificação dos Workflows do Monorepo Principal

#### `.github/workflows/ci.yml`
```yaml
name: CI — Quality, Security, Tests & Compose Smoke

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  quality-and-tests:
    name: Lint, Typecheck, Audit & Tests (Node 24)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Secret Scan (Gitleaks)
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prettier --check .
      - run: pnpm run lint:workspace
      - run: pnpm nx run-many -t typecheck
      - run: pnpm run test:workspace -- --coverage   # thresholds ≥ 80 % definidos no vitest.config (bloqueante)
      - run: pnpm run build:workspace
      - run: pnpm audit --prod --audit-level=critical

  compose-smoke:
    name: Docker Compose Config & Build Smoke
    runs-on: ubuntu-latest
    needs: quality-and-tests
    steps:
      - uses: actions/checkout@v4
      - run: cp .env.example .env
      - run: docker compose config -q
      - run: docker compose build
```

#### `.github/workflows/hotfix-verify.yml` (Validação Automática dos PRs Autônomos `hotfix/zeromttr-*`)
```yaml
name: Autonomous Hotfix PR Verification

on:
  pull_request:
    branches: [release/target-v2.14.8, main, master]

permissions:
  contents: read
  pull-requests: write

jobs:
  verify-autonomous-hotfix:
    if: startsWith(github.head_ref, 'hotfix/zeromttr-')
    name: Verify Autonomous ZeroMTTR Hotfix
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @zeromttr/target-app-demo run typecheck
      - run: pnpm --filter @zeromttr/target-app-demo run test

      - name: Comment Verification Badge on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const passed = '${{ job.status }}' === 'success';
            const body = passed
              ? '### ⚡ ZeroMTTR Autonomous CI Gate: **PASSED** ✅\n- **Branch:** `' + context.payload.pull_request.head.ref + '`\n- **Target Workload (`@zeromttr/target-app-demo`):** Regression & Pool Release Suite Green on Node.js 24 LTS\n- **Governance Status:** Ready for On-Call Engineer approval via Resend HMAC.'
              : '### ⚠️ ZeroMTTR Autonomous CI Gate: **FAILED** ❌\nRegression suite failed on this hotfix branch.';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

#### `.github/workflows/cd-release.yml` (Deploy na VPS restrito a Tags da Plataforma `v1.*.*` ou Disparo Manual — ignora tags de demo `v2.14.*`)
```yaml
name: CD — Publish Images (GHCR) & Controlled VPS Release

on:
  push:
    branches: [main, master]
    tags: ['v1.*.*']
  workflow_dispatch:
    inputs:
      deploy_to_vps:
        description: 'Deploy latest images to production VPS'
        required: false
        default: 'true'
        type: string

permissions:
  contents: write
  packages: write

env:
  REGISTRY: ghcr.io

jobs:
  publish-images:
    name: Build & Push to GHCR (${{ matrix.service }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [mcp-server, orchestrator, target-app-demo, dashboard]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ github.repository }}/${{ matrix.service }}
          tags: |
            type=sha
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v1.') || github.ref_name == github.event.repository.default_branch }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./apps/${{ matrix.service }}/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to: type=gha,mode=max,scope=${{ matrix.service }}

  github-release:
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v1.')
    needs: publish-images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

  deploy-vps:
    if: (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v1.')) || (github.event_name == 'workflow_dispatch' && inputs.deploy_to_vps == 'true')
    needs: publish-images
    runs-on: ubuntu-latest
    env:
      # O contexto `secrets` não é permitido em `if:` de step; expor via env do job
      VPS_HOST: ${{ secrets.VPS_HOST }}
    steps:
      - uses: actions/checkout@v4

      - name: Ensure deploy directory exists on VPS
        if: ${{ env.VPS_HOST != '' }}
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            mkdir -p ${{ secrets.VPS_DEPLOY_PATH }}/infra

      - name: Copy docker-compose.prod.yml and infra/ configs to VPS via SCP
        if: ${{ env.VPS_HOST != '' }}
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: "docker-compose.prod.yml,infra/**"
          target: "${{ secrets.VPS_DEPLOY_PATH }}"

      - name: Pull GHCR images & Restart Stack on VPS
        if: ${{ env.VPS_HOST != '' }}
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ${{ secrets.VPS_DEPLOY_PATH }}
            export ENV_FILE_PATH="${{ secrets.VPS_ENV_FILE_PATH }}"
            # Tag das imagens = versão da release (ex.: v1.0.0 -> 1.0.0, gerada por type=semver); manual -> latest
            export IMAGE_TAG="${{ startsWith(github.ref, 'refs/tags/v1.') && github.ref_name || 'latest' }}"
            export IMAGE_TAG="${IMAGE_TAG#v}"
            # Pacotes GHCR nascem privados: torná-los públicos (Package settings) OU autenticar antes do pull:
            # echo "$GHCR_READ_PAT" | docker login ghcr.io -u <usuario> --password-stdin
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml pull
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

---

### 3.2 Especificação do OTel Collector com Processor `transform` (OTTL PII Masking em `log.body`)
Em `infra/otel-collector-config.yaml` e `infra/otel-collector-config.prod.yaml`, o pipeline de `logs` aplica `transform/pii_logs` para garantir mascaramento determinístico no corpo (`body`) e nos atributos de todos os logs antes da persistência no Loki:

```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 200
    spike_limit_mib: 50

  transform/pii_logs:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          # Mascara CPF (ex.: 123.456.789-00 -> [REDACTED_CPF])
          - replace_pattern(body, "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          # Mascara CNPJ (ex.: 12.345.678/0001-99 -> [REDACTED_CNPJ])
          - replace_pattern(body, "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          # Mascara tokens Bearer / JWT (case-insensitive para Bearer)
          - replace_pattern(body, "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          # Mascara JWT cru sem prefixo Bearer (iniciado por eyJ)
          - replace_pattern(body, "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          # Mascara chaves PIX de e-mail em mensagens de erro
          - replace_pattern(body, "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          # Mascara telefones celulares (9 dígitos) e fixos ([2-5] + 7 dígitos) segundo regras da ANATEL
          - replace_pattern(body, "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          # Mascara Chave PIX Aleatória (EVP / UUID v4 RFC 4122 do BACEN em contexto PIX, case-insensitive no padrão inteiro)
          - replace_pattern(body, "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Aplica o mesmo mascaramento sobre atributos string do log
          - replace_all_patterns(attributes, "value", "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          - replace_all_patterns(attributes, "value", "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          - replace_all_patterns(attributes, "value", "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          - replace_all_patterns(attributes, "value", "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          - replace_all_patterns(attributes, "value", "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          - replace_all_patterns(attributes, "value", "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Mascara Chave PIX Aleatória (EVP) quando enviada diretamente em atributo nomeado de PIX
          - replace_pattern(attributes["pixKey"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["pixKey"] != nil
          - replace_pattern(attributes["chave_pix"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["chave_pix"] != nil
          - replace_pattern(attributes["evp"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["evp"] != nil
          # Promove service.name do resource para label de stream "service" no Loki
          - set(resource.attributes["loki.resource.labels"], "service.name")
          - set(attributes["service"], resource.attributes["service.name"])
          - set(attributes["loki.attribute.labels"], "service")

  redaction:
    allow_all_keys: true
    blocked_values:
      - "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b"
      - "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b"
      - "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*"
      - "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b"
      - "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}"
      - "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)"
      - "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b"

  tail_sampling:
    decision_wait: 5s
    num_traces: 500
    expected_new_traces_per_sec: 50
    policies:
      - name: errors-policy
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow-traces-policy
        type: latency
        latency: { threshold_ms: 500 }

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, redaction, tail_sampling, batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheusremotewrite]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, transform/pii_logs, batch]
      exporters: [loki]
```

---

### 3.3 `apps/dashboard/nginx.conf.template` (Injeta `DASHBOARD_API_TOKEN` segregado)
> **Regra Crítica do Entrypoint `nginx:alpine`:** Definir obrigatoriamente `ENV NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$` no `Dockerfile` do `apps/dashboard` (e no `environment:` do `docker-compose.yml` / `docker-compose.prod.yml`) para que o script `/docker-entrypoint.d/20-envsubst-on-templates.sh` substitua **apenas** `${DASHBOARD_API_TOKEN}` e preserve intactas as variáveis nativas do Nginx (`$host`, `$remote_addr`, `$uri`).

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;

    # Proxy reverso interno apenas para /api/* -> orchestrator:8080 (nunca expõe /webhook/*)
    location /api/ {
        proxy_pass http://orchestrator:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Authorization "Bearer ${DASHBOARD_API_TOKEN}";

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400s;
        add_header X-Accel-Buffering "no" always;
        add_header Cache-Control "no-cache, no-transform" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 4. Critérios de Aceite
- [ ] `pnpm install --frozen-lockfile && pnpm run check:workspace` passam em checkout limpo via Nx.
- [ ] `docker compose up -d` deixa Prometheus, Loki, Tempo, Grafana e Collector `healthy` em ≤ 90 s.
- [ ] Um log OTLP contendo CPF (`123.456.789-00`), CNPJ (`12.345.678/0001-99`) e `Bearer eyJ...` no `body` é gravado no Loki com `[REDACTED_CPF]`, `[REDACTED_CNPJ]` e `Bearer [REDACTED_TOKEN]`.
- [ ] Grafana lista os 3 datasources sem erro e o contact point usa `GRAFANA_WEBHOOK_TOKEN`.
- [ ] CI verde no GitHub; nenhum segredo no repositório.
