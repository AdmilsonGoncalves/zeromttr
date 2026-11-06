# TECH 01 — Fundação e Infraestrutura (Fase 1)

**Pré-requisito de leitura:** `AGENTS.md`, [00_architecture_master.md](../00_architecture_master.md)
**Fonte de código (apoio local, não versionado):** `docs/apoio/especifica_o_t_cnica_e_arquitetura_aiops_com_mcp_grafana_e_opentelemetry.md`, `docs/apoio/zeromttr_antigravity_blueprint_v2.md` (§3.1–3.4) e `docs/apoio/cloudflare_bind_zone_file.txt`
**Objetivo:** monorepo com CI/CD, DNS (`agjworks.com`) e stack LGTM saudável via `docker compose up`.

## 1. Escopo
Estrutura de pastas, tooling, CI e stack de observabilidade. **Sem** código de negócio.

## 2. Tarefas

### T1.1 Esqueleto do monorepo (`pnpm` + `Nx` em `apps/*`)
Criar a estrutura da §7 do mestre:
- **Gerenciador de pacotes:** **pnpm** (`packageManager: "pnpm@10.x"` no `package.json` raiz via Corepack) + `pnpm-workspace.yaml` com `packages: ['apps/*']` (`apps/mcp-server`, `apps/orchestrator`, `apps/target-app-demo`, `apps/dashboard`).
- **Orquestrador de monorepo:** **Nx (Package-Based)** com `nx.json` enxuto na raiz configurando `targetDefaults` (`build`, `lint`, `typecheck`, `test` com cache local habilitado).
- **TypeScript & Runtime:** `tsconfig.base.json` na raiz (`strict`, `ES2024`, `NodeNext`), Node 24 em `.nvmrc` e `engines` (`>=24.0.0`).
- **`.dockerignore` na raiz:** ignorar `node_modules/`, `.nx/`, `dist/`, `coverage/`, `.git/` e `docs/` para manter o contexto de build Docker (`context: .`) abaixo de 2 MB.

### T1.2 Tooling de qualidade & Scripts enxutos (`*:workspace`)
ESLint (flat config `eslint.config.mjs`) + Prettier + Husky (`pre-commit` com `lint-staged` e `pre-push` rodando `pnpm run check:workspace`) + Commitlint (Conventional Commits).
- **Regras obrigatórias no `eslint.config.mjs` raiz:**
  1. **Fronteira Hexagonal (`no-restricted-imports`):** arquivos em `apps/{mcp-server,orchestrator}/src/{domain,application}/**/*.ts` são proibidos de importar `../adapters/**`, `../transport/**`, `../http/**`, `express`, `axios` ou `@modelcontextprotocol/sdk`.
  2. **Segurança Assíncrona:** `@typescript-eslint/no-floating-promises` e `@typescript-eslint/no-misused-promises` habilitados.
- **Scripts enxutos no `package.json` da raiz (apenas os 4 essenciais):**
  ```json
  {
    "scripts": {
      "check:workspace": "nx run-many --target=lint --all --fix && nx run-many --targets=typecheck,test,build --all --parallel=4",
      "lint:workspace": "nx run-many --target=lint --all",
      "test:workspace": "nx run-many --target=test --all",
      "build:workspace": "nx run-many --target=build --all"
    }
  }
  ```

### T1.3 Infra em `infra/`
Colocar os arquivos de configuração (collector, Prometheus, Tempo, Loki e datasources) em `infra/` e ajustar os volumes do compose. Pontos obrigatórios:

| Arquivo | Requisito |
| :--- | :--- |
| `datasources.yaml` | Adicionar `uid: prometheus-datasource` ao Prometheus (`tracesToMetrics` referencia esse uid) |
| `docker-compose.yml` | Remover `env_file` obrigatório (ou usar `required: false`); adicionar healthchecks de Tempo e Grafana; incluir serviços `mcp-server`, `orchestrator`, `target-app-demo`, `postgres` e `dashboard` (nginx com proxy `/api` → orquestrador) |
| `otel-collector-config.yaml` | **Validar** que o `redaction` atua em logs na versão usada; se não, usar `transform`/`attributes` para logs (risco R4) |
| `tempo-config.yaml` | Habilitar `metrics_generator` somente se necessário para exemplars de service graph |

### T1.4 Alerting provisionado
Criar `infra/grafana/provisioning/alerting/`:
- `contact-points.yaml`: webhook para `http://orchestrator:8080/webhook/grafana-alert` com header `Authorization: Bearer ${WEBHOOK_TOKEN}`.
- `rules.yaml`: regra "high error rate / p95 latency" sobre a métrica do demo app, `for: 30s`, labels `service`, `severity`.
- `policies.yaml`: rota padrão para o contact point.

### T1.5 CI/CD com GitHub Actions (`.github/workflows/`)
Criar os 3 workflows em `.github/workflows/` (templates de referência na §3.1):
1. **`ci.yml`:** Node 24 + `pnpm/action-setup@v4`, `pnpm install --frozen-lockfile`, lint, typecheck, `gitleaks`, testes com cobertura (≥ 80 %) via Nx, build, `docker compose config` e smoke test dos contêineres.
2. **`hotfix-verify.yml`:** dispara em Pull Requests de branches `hotfix/zeromttr-*` abertas autonomamente pelo **ZeroMTTR**, roda os testes de regressão do `apps/target-app-demo` e comenta o resultado de certificação no próprio PR via `GITHUB_TOKEN`.
3. **`cd-release.yml`:** em push na `main`/`master` e tags `v*`, publica as imagens Docker no **GitHub Container Registry (`ghcr.io/admilsongoncalves/zeromttr/*`)** com cache `type=gha` e gera a GitHub Release automática em tags `v*`.

### T1.6 Documentação inicial
`README.md` (en-US) e `README.pt-BR.md` com badge **Node.js 24 LTS**. `LICENSE` MIT. `.env.example` (ver §3). Criar também o `AGENTS.md` na raiz (contexto para agentes de IA): visão geral, estrutura do monorepo (`pnpm` + `Nx` em `apps/*`), convenções (Node 24, TypeScript `strict`, TDD, SOLID, idioma), links para `docs/pt-BR/00_architecture_master.md` e `docs/pt-BR/tech/` e roteiro por fases. Ele deve refletir a estrutura `apps/mcp-server/` + `apps/orchestrator/` + `apps/target-app-demo/` + `apps/dashboard/` + `infra/`.

### T1.7 Configuração de Deploy Blindado na VPS (`docker-compose.prod.yml` + `env_file` externo + Traefik)
Criar `docker-compose.prod.yml`, `infra/otel-collector-config.prod.yaml` e `apps/dashboard/nginx.conf.template` (especificados na §3.2) para hospedar a aplicação em produção em uma VPS Linux atrás de **Traefik + Cloudflare**:
- **Chaves isoladas fora do repositório em diretório restrito no host** (ex.: `/path/to/secrets/.env` com `chown $VPS_USER:$VPS_USER /path/to/secrets/.env && chmod 600 /path/to/secrets/.env`), referenciado via variável/secret `${ENV_FILE_PATH}` (`env_file: [${ENV_FILE_PATH:-.env}]` e `--env-file /path/to/secrets/.env`).
- **Zero portas publicadas no host (`expose:` apenas):** nenhum serviço usa `ports:` (evitando que o Docker manipule o `iptables` e ignore o UFW). Todos os bancos de telemetria (`prometheus`, `loki`, `tempo`, `otel-collector`, `postgres`, `grafana`, `mcp-server`, `orchestrator`, `target-app-demo`) ficam 100% isolados na rede interna `aiops-net`.
- **Ingresso único via `dashboard` (Nginx) na `traefik-public`:** apenas o container `dashboard` conecta na rede externa do Traefik (`Host(${ZEROMTTR_DOMAIN})`), servindo o SPA Angular em `/` e fazendo proxy reverso interno de `/api/*` para `orchestrator:8080` com injeção automática do `Authorization: Bearer ${WEBHOOK_TOKEN}` e headers anti-buffering de SSE (`X-Accel-Buffering: no`, `proxy_buffering off`).
- **Teto de RAM enxuto (~1.7 GB total):** `mem_limit` + `deploy.resources.limits` em todos os containers e `num_traces: 500` / `limit_mib: 200` no OTel Collector.

## 3. Variáveis de ambiente (`.env.example` para dev local / `.env.prod.template` para a VPS)
> **Regra de formatação:** nunca usar comentários *inline* na mesma linha do valor (para evitar que o parser `env_file` do Docker incorpore o comentário ao valor) e sempre envolver valores com espaços ou `< >` em aspas duplas.

```dotenv
# VPS / Traefik / Grafana Admin (AGJ Works)
ZEROMTTR_DOMAIN=zeromttr.agjworks.com
TRAEFIK_NETWORK_NAME=traefik_default
GRAFANA_ADMIN_USER=admilson
GRAFANA_ADMIN_PASSWORD=change-me-strong-password

# Observability (rede interna Docker aiops-net)
PROMETHEUS_URL=http://prometheus:9090
LOKI_URL=http://loki:3100
TEMPO_URL=http://tempo:3200
GRAFANA_URL=http://grafana:3000
# Token de Service Account com papel Editor (para POST /api/annotations); se vazio no demo local, usa Basic Auth admin
GRAFANA_SA_TOKEN=

# Security & Rate Limiting
MCP_AUTH_TOKEN=change-me
WEBHOOK_TOKEN=change-me
# Assina links de Aprovar/Rejeitar do e-mail e botões do Quadrante 4
DECISION_HMAC_SECRET=change-me
# Chave para forçar Live API Mode na VPS pública (vazio em dev local = modo live liberado; preenchido na VPS = protege créditos)
LIVE_DEMO_KEY=
# Cooldown global de 2 min entre simulações
SIMULATION_COOLDOWN_MS=120000
# Em dev local aponta para localhost; na VPS (.env de produção) usar https://zeromttr.agjworks.com
PUBLIC_BASE_URL=http://localhost:8080
PUBLIC_DASHBOARD_URL=http://localhost:4200

# Orchestrator -> MCP & Demo
MCP_URL=http://mcp-server:8000
TARGET_DEMO_URL=http://target-app-demo:3001
DATABASE_URL=postgres://zeromttr:zeromttr@postgres:5432/payments

# External Integrations (GitHub API & Resend)
# Fine-grained PAT com permissões Contents (Read/Write) e Pull Requests (Read/Write) no repositório-alvo
GITHUB_TOKEN=
TARGET_GITHUB_REPO=https://github.com/AdmilsonGoncalves/zeromttr
TARGET_SERVICE_PATH=apps/target-app-demo
RESEND_API_KEY=
RESEND_FROM="ZeroMTTR - AGJ Works <sre@zeromttr.agjworks.com>"
ON_CALL_ENGINEER_EMAIL=admilson@agjworks.com

# LLM (Orchestrator ReasoningPort)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
LLM_API_KEY=

# Demo app
CHAOS_ENABLED=true
DEMO_MODE=true
```

### 3.1 Especificação dos Workflows do GitHub Actions

#### `.github/workflows/ci.yml` (Quality, Security, Tests & Compose Smoke)
```yaml
name: CI — Quality, Tests & Compose Smoke

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  quality-and-tests:
    name: Lint, Typecheck & Unit/Contract Tests (Node 24)
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
      - run: pnpm run lint:workspace
      - run: pnpm nx run-many --target=typecheck --all
      - run: pnpm run test:workspace -- --coverage
      - run: pnpm run build:workspace
      - run: pnpm audit --prod --audit-level=high || true

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

#### `.github/workflows/hotfix-verify.yml` (Validação Automática dos PRs Autônomos)
```yaml
name: Autonomous Hotfix PR Verification

on:
  pull_request:
    branches: [main, master]

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
      - run: pnpm nx run-many --target=typecheck --all
      - run: pnpm run test:workspace

      - name: Comment Verification Badge on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const passed = '${{ job.status }}' === 'success';
            const body = passed
              ? '### ⚡ ZeroMTTR Autonomous CI Gate: **PASSED** ✅\n- **Branch:** `' + context.payload.pull_request.head.ref + '`\n- **Typecheck & Regression Suite:** Green on Node.js 24 LTS\n- **Governance Status:** Ready for On-Call Engineer approval via Resend / War Room.'
              : '### ⚠️ ZeroMTTR Autonomous CI Gate: **FAILED** ❌\nRegression suite or typecheck failed on this hotfix branch.';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

#### `.github/workflows/cd-release.yml` (CD — GHCR Image Publish & GitHub Release)
```yaml
name: CD — Publish Images (GHCR) & Release

on:
  push:
    branches: [main, master]
    tags: ['v*.*.*']
  workflow_dispatch:

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
            type=raw,value=latest,enable={{is_default_branch}}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./apps/${{ matrix.service }}/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  github-release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: publish-images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

  deploy-vps:
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master'
    needs: publish-images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Ensure deploy directory exists on VPS
        if: ${{ secrets.VPS_HOST != '' }}
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            mkdir -p ${{ secrets.VPS_DEPLOY_PATH }}/infra

      - name: Copy docker-compose.prod.yml and infra/ configs to VPS via SCP
        if: ${{ secrets.VPS_HOST != '' }}
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: "docker-compose.prod.yml,infra/**"
          target: "${{ secrets.VPS_DEPLOY_PATH }}"

      - name: Pull GHCR images & Restart Stack on VPS
        if: ${{ secrets.VPS_HOST != '' }}
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          port: ${{ secrets.VPS_PORT || 22 }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ${{ secrets.VPS_DEPLOY_PATH }}
            export ENV_FILE_PATH="${{ secrets.VPS_ENV_FILE_PATH }}"
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml pull
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

---

### 3.2 Especificação de Produção na VPS (`docker-compose.prod.yml`, `ENV_FILE_PATH`, Nginx & Collector Enxuto)

O fluxo é **100% Dev Local $\rightarrow$ Git Push $\rightarrow$ GitHub Actions $\rightarrow$ VPS**:
1. Você desenvolve e valida localmente na sua máquina (`docker compose up`).
2. Ao dar `git push origin main`, o GitHub Actions compila as 4 imagens Docker nos servidores do GitHub (poupando 100% de CPU/RAM de build na VPS), publica no GHCR (`ghcr.io`), transfere apenas `docker-compose.prod.yml` e a pasta `infra/` via SCP para `${{ secrets.VPS_DEPLOY_PATH }}` e executa `docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d` via SSH (por exemplo, com `ENV_FILE_PATH=/path/to/secrets/.env`):

```zsh
export ENV_FILE_PATH=/path/to/secrets/.env
docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d
```

#### `docker-compose.prod.yml` (Blindado: Zero `ports:` no host + Limites de RAM + Traefik + `ENV_FILE_PATH` externo)
```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.114.0
    container_name: zeromttr-otel-collector
    restart: unless-stopped
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./infra/otel-collector-config.prod.yaml:/etc/otelcol-contrib/config.yaml:ro
    expose:
      - "4317"
      - "4318"
      - "8888"
    depends_on:
      prometheus:
        condition: service_healthy
      loki:
        condition: service_healthy
      tempo:
        condition: service_started
    mem_limit: 256m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
    networks:
      - aiops-net

  prometheus:
    image: prom/prometheus:v2.54.1
    container_name: zeromttr-prometheus
    restart: unless-stopped
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=3d
      - --web.enable-remote-write-receiver
      - --enable-feature=exemplar-storage
      - --web.enable-lifecycle
    volumes:
      - ./infra/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prom_data:/prometheus
    expose:
      - "9090"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --tries=1 --spider http://localhost:9090/-/healthy || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
    mem_limit: 384m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 384M
          cpus: '0.50'
    networks:
      - aiops-net

  tempo:
    image: grafana/tempo:2.6.0
    container_name: zeromttr-tempo
    restart: unless-stopped
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./infra/tempo-config.yaml:/etc/tempo.yaml:ro
      - tempo_data:/tmp/tempo
    expose:
      - "3200"
      - "4317"
    mem_limit: 256m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
    networks:
      - aiops-net

  loki:
    image: grafana/loki:3.2.0
    container_name: zeromttr-loki
    restart: unless-stopped
    command: ["-config.file=/etc/loki/local-config.yaml"]
    volumes:
      - ./infra/loki-config.yaml:/etc/loki/local-config.yaml:ro
      - loki_data:/tmp/loki
    expose:
      - "3100"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --tries=1 --spider http://localhost:3100/ready || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
    mem_limit: 384m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 384M
          cpus: '0.50'
    networks:
      - aiops-net

  grafana:
    image: grafana/grafana:11.2.0
    container_name: zeromttr-grafana
    restart: unless-stopped
    env_file:
      - ${ENV_FILE_PATH:-.env}
    environment:
      - GF_SECURITY_ADMIN_USER=${GRAFANA_ADMIN_USER:-admilson}
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:?Defina GRAFANA_ADMIN_PASSWORD no arquivo .env}
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_FEATURE_TOGGLES_ENABLE=traceqlEditor
    volumes:
      - ./infra/grafana/provisioning:/etc/grafana/provisioning:ro
      - grafana_data:/var/lib/grafana
    expose:
      - "3000"
    depends_on:
      - prometheus
      - loki
      - tempo
    mem_limit: 256m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
    networks:
      - aiops-net

  postgres:
    image: postgres:16-alpine
    container_name: zeromttr-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=zeromttr
      - POSTGRES_PASSWORD=zeromttr
      - POSTGRES_DB=payments
    expose:
      - "5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zeromttr -d payments"]
      interval: 5s
      timeout: 3s
      retries: 5
    mem_limit: 192m
    cpus: 0.30
    deploy:
      resources:
        limits:
          memory: 192M
          cpus: '0.30'
    networks:
      - aiops-net

  target-app-demo:
    image: ghcr.io/admilsongoncalves/zeromttr/target-app-demo:latest
    container_name: zeromttr-target-demo
    restart: unless-stopped
    env_file:
      - ${ENV_FILE_PATH:-.env}
    environment:
      - NODE_ENV=production
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SERVICE_NAME=api-pagamentos-core
      - DATABASE_URL=postgres://zeromttr:zeromttr@postgres:5432/payments
    expose:
      - "3001"
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    mem_limit: 192m
    cpus: 0.30
    deploy:
      resources:
        limits:
          memory: 192M
          cpus: '0.30'
    networks:
      - aiops-net

  mcp-server:
    image: ghcr.io/admilsongoncalves/zeromttr/mcp-server:latest
    container_name: zeromttr-mcp-server
    restart: unless-stopped
    env_file:
      - ${ENV_FILE_PATH:-.env}
    environment:
      - NODE_ENV=production
      - MCP_PORT=8000
      - GRAFANA_URL=http://grafana:3000
      - PROMETHEUS_URL=http://prometheus:9090
      - LOKI_URL=http://loki:3100
      - TEMPO_URL=http://tempo:3200
    expose:
      - "8000"
    depends_on:
      - grafana
    mem_limit: 192m
    cpus: 0.40
    deploy:
      resources:
        limits:
          memory: 192M
          cpus: '0.40'
    networks:
      - aiops-net

  orchestrator:
    image: ghcr.io/admilsongoncalves/zeromttr/orchestrator:latest
    container_name: zeromttr-orchestrator
    restart: unless-stopped
    env_file:
      - ${ENV_FILE_PATH:-.env}
    environment:
      - NODE_ENV=production
      - PORT=8080
      - MCP_URL=http://mcp-server:8000
      - GRAFANA_URL=http://grafana:3000
      - TARGET_DEMO_URL=http://target-app-demo:3001
    expose:
      - "8080"
    depends_on:
      - mcp-server
      - target-app-demo
    mem_limit: 256m
    cpus: 0.50
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
    networks:
      - aiops-net

  dashboard:
    image: ghcr.io/admilsongoncalves/zeromttr/dashboard:latest
    container_name: zeromttr-dashboard
    restart: unless-stopped
    env_file:
      - ${ENV_FILE_PATH:-.env}
    expose:
      - "80"
    depends_on:
      - orchestrator
    mem_limit: 128m
    cpus: 0.25
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.25'
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.zeromttr-ui.rule=Host(`${ZEROMTTR_DOMAIN}`)"
      - "traefik.http.routers.zeromttr-ui.entrypoints=websecure"
      - "traefik.http.routers.zeromttr-ui.tls=true"
      - "traefik.http.routers.zeromttr-ui.tls.certresolver=letsencrypt"
      - "traefik.http.services.zeromttr-ui.loadbalancer.server.port=80"
      - "traefik.http.middlewares.zeromttr-sse.headers.customresponseheaders.X-Accel-Buffering=no"
      - "traefik.http.routers.zeromttr-ui.middlewares=zeromttr-sse"
    networks:
      - aiops-net
      - traefik-public

volumes:
  prom_data:
  tempo_data:
  loki_data:
  grafana_data:

networks:
  aiops-net:
    driver: bridge
  traefik-public:
    external: true
    name: ${TRAEFIK_NETWORK_NAME:-traefik_default}
```

#### `apps/dashboard/nginx.conf.template` (Injeta `Authorization` internamente + SSE sem buffer)
O container oficial `nginx:1.27-alpine` processa automaticamente arquivos em `/etc/nginx/templates/*.template` com `envsubst` no boot, injetando `${WEBHOOK_TOKEN}` (lido do `env_file`) sem nunca expô-lo ao navegador:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;

    # Proxy reverso interno apenas para /api/* -> orchestrator:8080 (rede interna aiops-net)
    location /api/ {
        proxy_pass http://orchestrator:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Authorization "Bearer ${WEBHOOK_TOKEN}";

        # Essencial para Server-Sent Events (SSE) em tempo real via Traefik/Cloudflare
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

#### `apps/dashboard/Dockerfile` (Build Context na raiz `.` com `pnpm`)
```dockerfile
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile --filter @zeromttr/dashboard...
COPY apps/dashboard ./apps/dashboard
RUN pnpm --filter @zeromttr/dashboard run build --configuration=production

FROM nginx:1.27-alpine AS runner
COPY apps/dashboard/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/dashboard/dist/dashboard/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Ajuste em `infra/otel-collector-config.prod.yaml` (Proteção contra OOMKill em 256MB)
```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 200          # Limite explícito compatível com os 256M do container
    spike_limit_mib: 50

  tail_sampling:
    decision_wait: 5s
    num_traces: 500         # Reduzido de 10000 para 500 para poupar RAM na VPS
    expected_new_traces_per_sec: 50
```

### 3.3 DNS Cloudflare (`agjworks.com`) & Entregabilidade do Resend
O arquivo de zona BIND de referência está em `docs/apoio/cloudflare_bind_zone_file.txt`:
- **Registros `A` (Proxied pelo Cloudflare):** `agjworks.com` e `zeromttr.agjworks.com` apontando para o IPv4 da VPS.
- **Registros `CNAME` (1º nível com hífen para compatibilidade com Universal SSL Free do Cloudflare):** `www.agjworks.com` → `agjworks.com`; `api-zeromttr.agjworks.com` e `grafana-zeromttr.agjworks.com` → `zeromttr.agjworks.com`.
- **Registros `CAA`:** autorizam emissão de certificados SSL Let's Encrypt no Traefik (`letsencrypt.org`) e Google Trust Services/SSL.com/DigiCert no Cloudflare (`pki.goog`, `ssl.com`, `digicert.com`).
- **DMARC & Resend 1-Click Cloudflare:** registro TXT `_dmarc.agjworks.com` (`v=DMARC1; p=none; rua=mailto:dmarc@agjworks.com`) e configuração automática de SPF/MX/DKIM para `send.zeromttr.agjworks.com` via botão *"Configure automatically with Cloudflare"* no painel do Resend, habilitando o envio autenticado por `ZeroMTTR • AGJ Works <sre@zeromttr.agjworks.com>`.

## 4. Critérios de aceite
- [ ] `pnpm install --frozen-lockfile && pnpm run check:workspace` passam em checkout limpo via Nx.
- [ ] `docker compose up -d` deixa Prometheus, Loki, Tempo, Grafana e Collector `healthy` em ≤ 90 s.
- [ ] Grafana lista os 3 datasources sem erro; "Test" verde.
- [ ] Regra de alerta e contact point aparecem provisionados no Grafana.
- [ ] CI verde no GitHub; nenhum segredo no repositório.
