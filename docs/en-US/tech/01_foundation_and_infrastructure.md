# TECH 01 — Foundation, OTTL Sanitization, and Infrastructure (Phase 1)

**Reading prerequisites:** `AGENTS.md`, [00_architecture_master.md](../00_architecture_master.md), [01_system_diagrams.md](../01_system_diagrams.md)
**Objective:** scaffold the monorepo from scratch with `pnpm` + `Nx`, configure the CI/CD pipeline, and bring up a healthy LGTM stack via `docker compose up` with deterministic PII masking via OTTL (`transform`).

## 1. Scope
Folder structure, quality tooling, observability stack configurations (`infra/`), and CI/CD workflows. All implementation must be written from scratch based on this specification.

## 2. Tasks

### T1.1 Monorepo Skeleton (`pnpm` + `Nx` in `apps/*`)
Create the structure defined in §7 of the master document:
- **Package manager:** **pnpm** (`packageManager: "pnpm@10.x"` in the root `package.json` via Corepack) + `pnpm-workspace.yaml` with `packages: ['apps/*', 'libs/*']` (`apps/mcp-server`, `apps/orchestrator`, `apps/target-app-demo`, `apps/dashboard`, `libs/utils`).
- **Monorepo orchestrator:** **Nx (Package-Based)** with a lean `nx.json` at the root configuring `targetDefaults` (`build`, `lint`, `typecheck`, `test` with local cache enabled).
- **TypeScript & Runtime:** `tsconfig.base.json` at the root (`strict`, `ES2024`, `NodeNext`), Node 24 in `.nvmrc` and `engines` (`>=24.0.0`).
- **`.dockerignore` at the root:** ignore `node_modules/`, `.nx/`, `dist/`, `coverage/`, `.git/`, and `docs/` to keep the Docker build context (`context: .`) under 2 MB.

### T1.2 Quality Tooling & Lean Scripts (`*:workspace`)
ESLint (flat config `eslint.config.mjs`) + Prettier + Husky (`pre-commit` with `lint-staged` and `pre-push` running `pnpm run check:workspace`) + Commitlint (Conventional Commits).
- **Mandatory rules in the root `eslint.config.mjs`:**
  1. **Hexagonal Boundary (`no-restricted-imports`):** files in `apps/{mcp-server,orchestrator}/src/{domain,application}/**/*.ts` are prohibited from importing `../adapters/**`, `../transport/**`, `../http/**`, `express`, `axios`, or `@modelcontextprotocol/sdk`.
  2. **Async Safety:** `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-misused-promises` enabled.
- **Lean scripts in the root `package.json` (only the 4 essentials using modern Nx 20 syntax):**
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

### T1.3 Observability Infrastructure in `infra/` and OTTL Masking (`transform`)
Create the configuration files for the LGTM stack and OpenTelemetry Collector in `infra/`:

| File | Technical Requirement |
| :--- | :--- |
| `datasources.yaml` | Configure Prometheus (`uid: prometheus-datasource` with `exemplarTraceIdDestinations` pointing to Tempo), Loki (with `derivedFields` extracting `trace_id`), and Tempo (`tracesToMetrics` and `tracesToLogs`). |
| `docker-compose.yml` | Local environment with healthchecks for Prometheus (must be started with `--config.file=/etc/prometheus/prometheus.yml --web.enable-remote-write-receiver --enable-feature=exemplar-storage` to retain `trace_id` exemplars), Loki, Tempo, Grafana, and PostgreSQL; include services `mcp-server`, `orchestrator`, `target-app-demo` (`api-pagamentos-core`), and `dashboard` (port `4200:80` and `NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$`). |
| `otel-collector-config.yaml` | **PII Masking in Logs via `transform` (OTTL) + `service` Mapping in Loki:** must configure the **`transform`** processor in the `logs` pipeline using OTTL functions `replace_pattern(log.body, ...)` and `replace_all_patterns(log.attributes, "value", ...)` to deterministically mask **CPF**, **CNPJ**, **PIX Key / Email**, and **Bearer / JWT** tokens before exporting to Loki, in addition to mapping `resource.attributes["service.name"]` to the `service` stream label in Loki (see §3.2). |
| `tempo-config.yaml` | OTLP gRPC (`4317`) and HTTP (`4318`) receivers with TraceQL search enabled. |

### T1.4 Provisioned Alerting with Segregated Token
Create `infra/grafana/provisioning/alerting/`:
- `contact-points.yaml`: webhook pointing to `http://orchestrator:8080/webhook/grafana-alert` authenticated with header `Authorization: Bearer ${GRAFANA_WEBHOOK_TOKEN}` (Grafana-exclusive token, separate from the Dashboard token; ensure the `GRAFANA_WEBHOOK_TOKEN` variable is injected into the `environment:` block of both the `grafana` and `orchestrator` containers in `docker-compose.yml` and `docker-compose.prod.yml`).
- `rules.yaml`: high p95 latency / connection saturation rule on `api-pagamentos-core` metrics, `for: 30s`, labels `service=api-pagamentos-core`, `severity=critical`.
- `policies.yaml`: default route linked to the contact point.

### T1.5 CI/CD with GitHub Actions (`.github/workflows/`)
Create the 3 workflows in `.github/workflows/`:
1. **`ci.yml`:** Node 24 + `pnpm/action-setup@v4`, `pnpm install --frozen-lockfile`, lint, typecheck, `gitleaks`, integration tests (Happy/Unhappy Paths) and helper function tests with `vitest --coverage` (thresholds ≥ 80% in `domain/` and `application/`, blocking) via Nx, `prettier --check .`, build, `pnpm audit --prod --audit-level=critical` (blocking for critical vulnerabilities), and `docker compose config` smoke test.
2. **`hotfix-verify.yml`:** triggers on Pull Requests from `hotfix/zeromttr-*` branches opened by ZeroMTTR (targeting `release/target-v2.14.8`), runs the `apps/target-app-demo` regression test suite, and posts the certification comment (`✅ ZeroMTTR Autonomous CI Gate: PASSED`) on the PR.
3. **`cd-release.yml`:** publishes Docker images to **GitHub Container Registry (`ghcr.io/admilsongoncalves/zeromttr/*`)**. **Operational stability rule:** the `deploy-vps` job **does not** run on every push to the main branch or on demo workload comparison tags (`v2.14.*`); it runs **exclusively when a platform release tag `v1.*.*` is published or via manual trigger (`workflow_dispatch`)**, keeping the demo VPS frozen and stable during evaluation periods.

### T1.6 Initial Documentation
`README.md` (en-US) and `README.pt-BR.md` stating the track (**Logistics & Automation** — workflow automation and cross-system integration), the open and domain-agnostic architecture, technical market positioning, local execution instructions, and a clear distinction between `Live` mode and `Replay` mode. Create `LICENSE` (MIT), `.env.example`, `AGENTS.md` (specification below), and `GEMINI.md` (just a pointer instructing to read and follow `AGENTS.md`, already created at the root).

#### `AGENTS.md` Specification (repository root)
Short, imperative file written in Portuguese, read by every coding agent before any implementation. It must contain the mandatory sections below:

1. **Context and Reading Order:** what ZeroMTTR is (Logistics & Automation track, domain-agnostic, single monorepo `AdmilsonGoncalves/zeromttr`) and the reading order: `00_architecture_master.md` → `01_system_diagrams.md` → `tech/NN_*.md` for the assigned task. Rule: implement **only** the assigned `tech/NN` document and stop when all acceptance criteria are green.
2. **Essential Commands:** `pnpm install --frozen-lockfile`, `pnpm run check:workspace`, `pnpm nx test <app>`, `pnpm nx run-many -t typecheck`, `docker compose up -d`.
3. **Architecture and Boundaries:**
   - `apps/orchestrator` and `apps/mcp-server`: Hexagonal (`domain` → `application` → `ports` → `adapters`, composition root in `main.ts`); the domain **never** imports adapters or frameworks (enforced by ESLint `no-restricted-imports`).
   - `apps/target-app-demo`: Layered MVC (`routes` → `controllers` → `services` → `repositories`).
   - `apps/dashboard`: Standalone Angular with Signals (`WarRoomComponent` + `DecisionComponent`).
   - The core remains agnostic: no `api-pagamentos-core` business rules may leak into the orchestrator or the MCP server.
4. **Testing Strategy (see [tech/06](./06_testing_and_quality.md)):**
   - *Testing Trophy*: integration and E2E first; unit tests only for pure helper functions.
   - Create helpers in `test/helpers/` **before** the test suites, without duplicating HTTP calls.
   - Write *Happy Paths* and *Unhappy Paths* **before** production code (Red → Green → Refactor), using `it.each` tables for regexes and validations.
   - Name tests by expected behavior (`should_...`).
   - **Prohibited** to call real external APIs (Gemini, GitHub, Resend) in the automated suite.
5. **Non-Negotiable Security Rules:**
   - Never commit secrets, `.env`, or `docs/apoio/`.
   - Never expose `sig`/`approveSig`/`rejectSig` in SSE or REST (only in the email, via `#fragment`).
   - Keep the 3 tokens segregated (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`).
   - Never use real PII (CPF, CNPJ, phone, email, PIX keys) in logs, fixtures, prompts, or documentation; use synthetic data only.
   - `PiiPromptGuard` always operates in *fail-closed* mode.
6. **Git Rules:**
   - Conventional Commits (Commitlint).
   - **Never run `git commit` or `git push` without an explicit order from the user.**
   - Never push directly to `master` (use branch + PR).
   - Never run `git push --force`.
7. **Demo Scenario Rules:**
   - The `v2.14.7` and `v2.14.8` tags and the `release/target-v2.14.8` branch are only created at the end of Phase 3, after `hotfix-verify.yml`, `pnpm-lock.yaml`, and `payment-pool.spec.ts` exist on `master`.
   - `v2.14.*` tags never trigger deploy; only `v1.*.*` tags or `workflow_dispatch` trigger `deploy-vps`.
   - `master` always remains healthy (`v2.14.7`); the regression lives exclusively on `release/target-v2.14.8`.
8. **Definition of Done:** checklist from [tech/06 §6](./06_testing_and_quality.md) (helpers without duplication, green *Happy*/*Unhappy* integration tests, `pnpm run check:workspace` 100% green, no secrets or PII, `tech/NN` acceptance criteria fulfilled).

### T1.7 Hardened VPS Deploy Configuration (`docker-compose.prod.yml` + Token Segregation)
Create `docker-compose.prod.yml`, `infra/otel-collector-config.prod.yaml`, and `apps/dashboard/nginx.conf.template`:
- **Secrets outside the repository** (e.g., `/path/to/secrets/.env` with `600` permissions), referenced via `${ENV_FILE_PATH}`.
- **Zero published host ports (`expose:` only):** all telemetry and backend services remain isolated on the `aiops-net` network.
- **Token segregation in Nginx:** the `dashboard` (Nginx) container injects `Authorization: Bearer ${DASHBOARD_API_TOKEN}` into the Dashboard's `/api/*` routes. The `GRAFANA_WEBHOOK_TOKEN` token never passes through Nginx.
- **RAM limits sized with headroom against OOMKill under load (~2.1 GB total):** `prometheus: 512M`, `loki: 512M`, `tempo: 384M`, `otel-collector: 256M` (`limit_mib: 200`), `grafana: 256M`, `orchestrator: 256M`, `mcp-server: 192M`, `target-app-demo: 192M`, `postgres: 192M`, `dashboard: 128M`.

---

## 3. Environment Variables (`.env.example` / `.env.prod.template`)
> **Formatting rule:** never use *inline* comments on the same line as a value, and always wrap values containing spaces or `< >` in double quotes.

```dotenv
# VPS / Traefik / Grafana Admin (AGJ Works)
ZEROMTTR_DOMAIN=zeromttr.agjworks.com
TRAEFIK_NETWORK_NAME=traefik_default
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=change-me-strong-password

# Observability (Docker internal network aiops-net)
PROMETHEUS_URL=http://prometheus:9090
LOKI_URL=http://loki:3100
TEMPO_URL=http://tempo:3200
GRAFANA_URL=http://grafana:3000
GRAFANA_SA_TOKEN=

# Token Segregation (Least Privilege)
MCP_AUTH_TOKEN=change-me-mcp-token
GRAFANA_WEBHOOK_TOKEN=change-me-grafana-webhook-token
DASHBOARD_API_TOKEN=change-me-dashboard-api-token
# Exclusively signs Approve/Reject links sent via email
DECISION_HMAC_SECRET=change-me-hmac-secret
# Key required on the public VPS to trigger real Live mode (protects quota against anonymous traffic)
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

# LLM (Orchestrator ReasoningPort — Configurable Model)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash
LLM_API_KEY=

# Workload Flags
CHAOS_ENABLED=true
DEMO_MODE=true
```

---

### 3.1 Main Monorepo Workflows Specification

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
      - run: pnpm run test:workspace -- --coverage   # thresholds ≥ 80% defined in vitest.config (blocking)
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

#### `.github/workflows/hotfix-verify.yml` (Automated Validation of Autonomous PRs `hotfix/zeromttr-*`)
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
      - run: pnpm --filter @zeromttr/target-app-demo^... run build
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

#### `.github/workflows/cd-release.yml` (VPS Deploy Restricted to Platform Tags `v1.*.*` or Manual Trigger — ignores demo tags `v2.14.*`)
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
      # The `secrets` context is not allowed in step `if:`; expose via job env
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
            # Image tag = release version (e.g., v1.0.0 -> 1.0.0, generated by type=semver); manual -> latest
            export IMAGE_TAG="${{ startsWith(github.ref, 'refs/tags/v1.') && github.ref_name || 'latest' }}"
            export IMAGE_TAG="${IMAGE_TAG#v}"
            # GHCR packages are created private: make them public (Package settings) OR authenticate before pull:
            # echo "$GHCR_READ_PAT" | docker login ghcr.io -u <user> --password-stdin
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml pull
            docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

---

### 3.2 OTel Collector Specification with `transform` Processor (OTTL PII Masking in `log.body`)
In `infra/otel-collector-config.yaml` and `infra/otel-collector-config.prod.yaml`, the `logs` pipeline applies `transform/pii_logs` to guarantee deterministic masking in the `body` and attributes of all logs prior to persistence in Loki:

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
          # Mask CPF (formatted and unformatted 11-digit, e.g., 123.456.789-00 -> [REDACTED_CPF])
          - replace_pattern(body, "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          - replace_pattern(body, "\\b\\d{11}\\b", "[REDACTED_CPF]")
          # Mask CNPJ (e.g., 12.345.678/0001-99 -> [REDACTED_CNPJ])
          - replace_pattern(body, "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          # Mask Bearer / JWT tokens (case-insensitive for Bearer)
          - replace_pattern(body, "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          # Mask raw JWT without Bearer prefix (starting with eyJ)
          - replace_pattern(body, "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          # Mask email PIX keys in error messages
          - replace_pattern(body, "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          # Mask mobile (9 digits) and landline ([2-5] + 7 digits) phones per ANATEL rules
          - replace_pattern(body, "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          # Mask Random PIX Key (EVP / BACEN RFC 4122 UUID v4 in PIX context, case-insensitive across entire pattern)
          - replace_pattern(body, "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Apply the same masking to string attributes of the log
          - replace_all_patterns(attributes, "value", "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "\\b\\d{11}\\b", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          - replace_all_patterns(attributes, "value", "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          - replace_all_patterns(attributes, "value", "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          - replace_all_patterns(attributes, "value", "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          - replace_all_patterns(attributes, "value", "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          - replace_all_patterns(attributes, "value", "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Mask Random PIX Key (EVP) when sent directly in a PIX-named attribute
          - replace_pattern(attributes["pixKey"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["pixKey"] != nil
          - replace_pattern(attributes["chave_pix"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["chave_pix"] != nil
          - replace_pattern(attributes["evp"], "\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", "[REDACTED_PIX_EVP]") where attributes["evp"] != nil
          # Promote resource service.name to the "service" stream label in Loki
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

### 3.3 `apps/dashboard/nginx.conf.template` (Injects Segregated `DASHBOARD_API_TOKEN`)
> **Critical `nginx:alpine` Entrypoint Rule:** Must define `ENV NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$` in the `apps/dashboard` `Dockerfile` (and in `environment:` of `docker-compose.yml` / `docker-compose.prod.yml`) so that `/docker-entrypoint.d/20-envsubst-on-templates.sh` substitutes **only** `${DASHBOARD_API_TOKEN}` and leaves native Nginx variables (`$host`, `$remote_addr`, `$uri`) intact.

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;

    # Internal reverse proxy only for /api/* -> orchestrator:8080 (never exposes /webhook/*)
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

## 4. Acceptance Criteria
- [ ] `pnpm install --frozen-lockfile && pnpm run check:workspace` pass on a clean checkout via Nx.
- [ ] `docker compose up -d` brings Prometheus, Loki, Tempo, Grafana, and Collector to `healthy` in ≤ 90 s.
- [ ] An OTLP log containing CPF (`123.456.789-00`), CNPJ (`12.345.678/0001-99`), and `Bearer eyJ...` in `body` is stored in Loki with `[REDACTED_CPF]`, `[REDACTED_CNPJ]`, and `Bearer [REDACTED_TOKEN]`.
- [ ] Grafana lists all 3 datasources without errors and the contact point uses `GRAFANA_WEBHOOK_TOKEN`.
- [ ] CI green on GitHub; no secrets in the repository.
