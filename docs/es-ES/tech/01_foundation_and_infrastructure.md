# TECH 01 — Fundamentos, Sanitización OTTL e Infraestructura (Fase 1)

**Prerrequisitos de lectura:** `AGENTS.md`, [00_architecture_master.md](../00_architecture_master.md), [01_system_diagrams.md](../01_system_diagrams.md)
**Objetivo:** crear el esqueleto del monorepo desde cero con `pnpm` + `Nx`, configurar el pipeline de CI/CD y levantar un stack LGTM saludable mediante `docker compose up` con enmascaramiento determinista de PII mediante OTTL (`transform`).

## 1. Alcance
Estructura de carpetas, herramientas de calidad, configuraciones del stack de observabilidad (`infra/`) y flujos de trabajo de CI/CD. Toda la implementación debe escribirse desde cero basándose en esta especificación.

## 2. Tareas

### T1.1 Esqueleto del Monorepo (`pnpm` + `Nx` en `apps/*`)
Crear la estructura definida en la §7 del documento maestro:
- **Gestor de paquetes:** **pnpm** (`packageManager: "pnpm@10.x"` en el `package.json` raíz mediante Corepack) + `pnpm-workspace.yaml` con `packages: ['apps/*', 'libs/*']` (`apps/mcp-server`, `apps/orchestrator`, `apps/target-app-demo`, `apps/dashboard`, `libs/utils`).
- **Orquestador del monorepo:** **Nx (Package-Based)** con un `nx.json` minimalista en la raíz que configure `targetDefaults` (`build`, `lint`, `typecheck`, `test` con caché local habilitada).
- **TypeScript y Runtime:** `tsconfig.base.json` en la raíz (`strict`, `ES2024`, `NodeNext`), Node 24 en `.nvmrc` y `engines` (`>=24.0.0`).
- **`.dockerignore` en la raíz:** ignorar `node_modules/`, `.nx/`, `dist/`, `coverage/`, `.git/` y `docs/` para mantener el contexto de build de Docker (`context: .`) por debajo de 2 MB.

### T1.2 Herramientas de Calidad y Scripts Minimalistas (`*:workspace`)
ESLint (flat config `eslint.config.mjs`) + Prettier + Husky (`pre-commit` con `lint-staged` y `pre-push` ejecutando `pnpm run check:workspace`) + Commitlint (Conventional Commits).
- **Reglas obligatorias en el `eslint.config.mjs` raíz:**
  1. **Frontera Hexagonal (`no-restricted-imports`):** los archivos en `apps/{mcp-server,orchestrator}/src/{domain,application}/**/*.ts` tienen prohibido importar `../adapters/**`, `../transport/**`, `../http/**`, `express`, `axios` o `@modelcontextprotocol/sdk`.
  2. **Seguridad Asíncrona:** `@typescript-eslint/no-floating-promises` y `@typescript-eslint/no-misused-promises` habilitadas.
- **Scripts minimalistas en el `package.json` raíz (solo los 4 esenciales usando la sintaxis moderna de Nx 20):**
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

### T1.3 Infraestructura de Observabilidad en `infra/` y Enmascaramiento OTTL (`transform`)
Crear los archivos de configuración para el stack LGTM y OpenTelemetry Collector en `infra/`:

| Archivo | Requisito Técnico |
| :--- | :--- |
| `datasources.yaml` | Configurar Prometheus (`uid: prometheus-datasource` con `exemplarTraceIdDestinations` apuntando a Tempo), Loki (con `derivedFields` extrayendo `trace_id`) y Tempo (`tracesToMetrics` y `tracesToLogs`). |
| `docker-compose.yml` | Entorno local con healthchecks para Prometheus (debe iniciarse con `--config.file=/etc/prometheus/prometheus.yml --web.enable-remote-write-receiver --enable-feature=exemplar-storage` para retener los ejemplares `trace_id`), Loki, Tempo, Grafana y PostgreSQL; incluir los servicios `mcp-server`, `orchestrator`, `target-app-demo` (`api-pagamentos-core`) y `dashboard` (puerto `4200:80` y `NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$`). |
| `otel-collector-config.yaml` | **Enmascaramiento de PII en Logs mediante `transform` (OTTL) + mapeo de `service` en Loki:** debe configurar el procesador **`transform`** en el pipeline de `logs` utilizando las funciones OTTL `replace_pattern(log.body, ...)` y `replace_all_patterns(log.attributes, "value", ...)` para enmascarar de forma determinista **CPF**, **CNPJ**, **Clave PIX / Correo electrónico** y tokens **Bearer / JWT** antes de exportar a Loki, además de mapear `resource.attributes["service.name"]` a la etiqueta de stream `service` en Loki (véase §3.2). |
| `tempo-config.yaml` | Receptores OTLP gRPC (`4317`) y HTTP (`4318`) con búsqueda TraceQL habilitada. |

### T1.4 Alertas Aprovisionadas con Token Segregado
Crear `infra/grafana/provisioning/alerting/`:
- `contact-points.yaml`: webhook apuntando a `http://orchestrator:8080/webhook/grafana-alert` autenticado con la cabecera `Authorization: Bearer ${GRAFANA_WEBHOOK_TOKEN}` (token exclusivo de Grafana, separado del token del Dashboard; asegurar que la variable `GRAFANA_WEBHOOK_TOKEN` se inyecte en el bloque `environment:` de los contenedores `grafana` y `orchestrator` tanto en `docker-compose.yml` como en `docker-compose.prod.yml`).
- `rules.yaml`: regla de latencia p95 alta / saturación de conexiones en las métricas de `api-pagamentos-core`, `for: 30s`, etiquetas `service=api-pagamentos-core`, `severity=critical`.
- `policies.yaml`: ruta predeterminada vinculada al punto de contacto.

### T1.5 CI/CD con GitHub Actions (`.github/workflows/`)
Crear los 3 flujos de trabajo en `.github/workflows/`:
1. **`ci.yml`:** Node 24 + `pnpm/action-setup@v4`, `pnpm install --frozen-lockfile`, lint, typecheck, `gitleaks`, tests de integración (Happy/Unhappy Paths) y tests de funciones auxiliares con `vitest --coverage` (umbrales ≥ 80 % en `domain/` y `application/`, bloqueantes) mediante Nx, `prettier --check .`, build, `pnpm audit --prod --audit-level=critical` (bloqueante para vulnerabilidades críticas) y smoke test de `docker compose config`.
2. **`hotfix-verify.yml`:** se activa en Pull Requests desde ramas `hotfix/zeromttr-*` abiertas por ZeroMTTR (dirigidas a `release/target-v2.14.8`), ejecuta la suite de tests de regresión de `apps/target-app-demo` y publica el comentario de certificación (`✅ ZeroMTTR Autonomous CI Gate: PASSED`) en el PR.
3. **`cd-release.yml`:** publica imágenes Docker en **GitHub Container Registry (`ghcr.io/admilsongoncalves/zeromttr/*`)**. **Regla de estabilidad operativa:** el job `deploy-vps` **no** se ejecuta en cada push a la rama principal ni en etiquetas de comparación de carga de demo (`v2.14.*`); se ejecuta **exclusivamente cuando se publica una etiqueta de versión de la plataforma `v1.*.*` o mediante disparo manual (`workflow_dispatch`)**, manteniendo el VPS de demo congelado y estable durante los periodos de evaluación.

### T1.6 Documentación Inicial
`README.md` (en-US) y `README.pt-BR.md` indicando la categoría (**Logística y Automatización** — automatización de flujos de trabajo e integración entre sistemas), la arquitectura abierta y agnóstica de dominio, el posicionamiento técnico de mercado, instrucciones de ejecución local y una distinción clara entre el modo `Live` y el modo `Replay`. Crear `LICENSE` (MIT), `.env.example`, `AGENTS.md` (especificación a continuación) y `GEMINI.md` (solo un puntero que instruya leer y seguir `AGENTS.md`, ya creado en la raíz).

#### Especificación de `AGENTS.md` (raíz del repositorio)
Archivo breve e imperativo redactado en portugués, leído por cada agente de codificación antes de cualquier implementación. Debe contener las secciones obligatorias siguientes:

1. **Contexto y Orden de Lectura:** qué es ZeroMTTR (categoría Logística y Automatización, agnóstico de dominio, monorepo único `AdmilsonGoncalves/zeromttr`) y el orden de lectura: `00_architecture_master.md` → `01_system_diagrams.md` → `tech/NN_*.md` de la tarea asignada. Regla: implementar **únicamente** el documento `tech/NN` asignado y detenerse cuando todos los criterios de aceptación estén en verde.
2. **Comandos Esenciales:** `pnpm install --frozen-lockfile`, `pnpm run check:workspace`, `pnpm nx test <app>`, `pnpm nx run-many -t typecheck`, `docker compose up -d`.
3. **Arquitectura y Fronteras:**
   - `apps/orchestrator` y `apps/mcp-server`: Hexagonal (`domain` → `application` → `ports` → `adapters`, composition root en `main.ts`); el dominio **nunca** importa adaptadores ni frameworks (impuesto por ESLint `no-restricted-imports`).
   - `apps/target-app-demo`: MVC en capas (`routes` → `controllers` → `services` → `repositories`).
   - `apps/dashboard`: Angular standalone con Signals (`WarRoomComponent` + `DecisionComponent`).
   - El núcleo permanece agnóstico: ninguna regla de negocio de `api-pagamentos-core` puede filtrarse hacia el orquestador o el servidor MCP.
4. **Estrategia de Testing (véase [tech/06](./06_testing_and_quality.md)):**
   - *Testing Trophy*: integración y E2E primero; tests unitarios únicamente para funciones auxiliares puras.
   - Crear helpers en `test/helpers/` **antes** que las suites de tests, sin duplicar llamadas HTTP.
   - Escribir *Happy Paths* y *Unhappy Paths* **antes** que el código de producción (Red → Green → Refactor), utilizando tablas `it.each` para regexes y validaciones.
   - Nombrar los tests según el comportamiento esperado (`should_...`).
   - **Prohibido** llamar a APIs externas reales (Gemini, GitHub, Resend) en la suite automatizada.
5. **Reglas de Seguridad Innegociables:**
   - Nunca hacer commit de secretos, `.env` ni `docs/apoio/`.
   - Nunca exponer `sig`/`approveSig`/`rejectSig` en SSE ni en REST (solo en el correo electrónico, mediante `#fragment`).
   - Mantener los 3 tokens segregados (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`).
   - Nunca usar PII real (CPF, CNPJ, teléfono, correo electrónico, claves PIX) en logs, fixtures, prompts ni documentación; usar únicamente datos sintéticos.
   - `PiiPromptGuard` opera siempre en modo *fail-closed*.
6. **Reglas de Git:**
   - Conventional Commits (Commitlint).
   - **Nunca ejecutar `git commit` ni `git push` sin una orden explícita del usuario.**
   - Nunca hacer push directo a `master` (usar rama + PR).
   - Nunca ejecutar `git push --force`.
7. **Reglas del Escenario de Demo:**
   - Las etiquetas `v2.14.7` y `v2.14.8` y la rama `release/target-v2.14.8` solo se crean al final de la Fase 3, después de que `hotfix-verify.yml`, `pnpm-lock.yaml` y `payment-pool.spec.ts` existan en `master`.
   - Las etiquetas `v2.14.*` nunca disparan despliegue; solo las etiquetas `v1.*.*` o `workflow_dispatch` activan `deploy-vps`.
   - `master` permanece siempre saludable (`v2.14.7`); la regresión vive exclusivamente en `release/target-v2.14.8`.
8. **Definition of Done:** lista de verificación de [tech/06 §6](./06_testing_and_quality.md) (helpers sin duplicación, tests de integración *Happy*/*Unhappy* en verde, `pnpm run check:workspace` 100 % en verde, sin secretos ni PII, criterios de aceptación de `tech/NN` cumplidos).

### T1.7 Configuración Endurecida de Despliegue en VPS (`docker-compose.prod.yml` + Segregación de Tokens)
Crear `docker-compose.prod.yml`, `infra/otel-collector-config.prod.yaml` y `apps/dashboard/nginx.conf.template`:
- **Secretos fuera del repositorio** (p. ej., `/path/to/secrets/.env` con permisos `600`), referenciados mediante `${ENV_FILE_PATH}`.
- **Cero puertos publicados en el host (`expose:` únicamente):** todos los servicios de telemetría y backend permanecen aislados en la red `aiops-net`.
- **Segregación de tokens en Nginx:** el contenedor `dashboard` (Nginx) inyecta `Authorization: Bearer ${DASHBOARD_API_TOKEN}` en las rutas `/api/*` del Dashboard. El token `GRAFANA_WEBHOOK_TOKEN` nunca pasa por Nginx.
- **Límites de RAM dimensionados para coexistir en el VPS de ~2,2 GB (la suma de los topes individuales es `2880M`; el consumo agregado medido bajo carga en los 10 contenedores permanece `<= 1,0 GiB`):** `prometheus: 512M`, `loki: 512M`, `tempo: 384M`, `otel-collector: 256M` (`limit_mib: 200`), `grafana: 256M`, `orchestrator: 256M`, `mcp-server: 192M`, `target-app-demo: 192M`, `postgres: 192M`, `dashboard: 128M`.

---

## 3. Variables de Entorno (`.env.example` / `.env.prod.template`)
> **Regla de formato:** nunca usar comentarios *en línea* en la misma línea que un valor, y envolver siempre entre comillas dobles los valores que contengan espacios o `< >`.

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
RESEND_FROM="ZeroMTTR - AGJ Works <sre@zeromttr.agjworks.com>"
ON_CALL_ENGINEER_EMAIL=oncall-sre@example.com

# LLM (Orchestrator ReasoningPort — Configurable Model)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash
LLM_API_KEY=

# Workload Flags
CHAOS_ENABLED=false
DEMO_MODE=true
```

---

### 3.1 Especificación de los Flujos de Trabajo Principales del Monorepo

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

#### `.github/workflows/hotfix-verify.yml` (Validación Automatizada de PRs Autónomos `hotfix/zeromttr-*`)
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

#### `.github/workflows/cd-release.yml` (Despliegue en VPS Restringido a Etiquetas de Plataforma `v1.*.*` o Disparo Manual — ignora etiquetas de demo `v2.14.*`)
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

### 3.2 Especificación de OTel Collector con el Procesador `transform` (Enmascaramiento OTTL de PII en `log.body`)
En `infra/otel-collector-config.yaml` e `infra/otel-collector-config.prod.yaml`, el pipeline de `logs` aplica `transform/pii_logs` para realizar enmascaramiento determinista mediante `replace_pattern` OTTL en el `body` de tipo string y los atributos de tipo string antes de su persistencia en Loki (véase [ADR-009](../adr/009-otel-collector-ottl-transform-pii-masking.md) sobre la limitación conocida con cuerpos de tipo map):

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
          # Mask formatted CPF (e.g., 123.456.789-00 -> [REDACTED_CPF])
          - replace_pattern(body, "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          # Mask CNPJ (formatted and unformatted 14-digit)
          - replace_pattern(body, "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          - replace_pattern(body, "(?:\\b|_)\\d{14}(?:\\b|_)", "[REDACTED_CNPJ]")
          # Mask Bearer / JWT tokens (case-insensitive for Bearer)
          - replace_pattern(body, "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          # Mask raw JWT without Bearer prefix (starting with eyJ)
          - replace_pattern(body, "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          # Mask email PIX keys before 11-digit CPF so numeric local-parts are not split
          - replace_pattern(body, "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          # Mask unformatted 11-digit CPF (including letter-prefixed such as CPF12345678901 and underscore-separated)
          - replace_pattern(body, "(?i:cpf)\\d{11}(?:\\b|_)", "CPF[REDACTED_CPF]")
          - replace_pattern(body, "(?:\\b|_)\\d{11}(?:\\b|_)", "[REDACTED_CPF]")
          - replace_pattern(body, "(?:\\b|_)\\d{11}(?:\\b|_)", "[REDACTED_CPF]")
          # Mask mobile (9 digits) and landline ([2-5] + 7 digits) phones per ANATEL rules and contextual unformatted numbers
          - replace_pattern(body, "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          - replace_pattern(body, "(?i:(?:phone|telefone|celular|tel|fone)[\"'=:\\s]+)(?:\\+?55\\s?)?[1-9]{2}(?:9\\d{8}|[2-5]\\d{7})\\b", "phone=[REDACTED_PHONE]")
          # Mask Random PIX Key (EVP / BACEN RFC 4122 UUID v4 in PIX context, case-insensitive across entire pattern)
          - replace_pattern(body, "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Apply the same masking to string attributes of the log
          - replace_all_patterns(attributes, "value", "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "\\b\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}\\b", "[REDACTED_CNPJ]")
          - replace_all_patterns(attributes, "value", "(?:\\b|_)\\d{14}(?:\\b|_)", "[REDACTED_CNPJ]")
          - replace_all_patterns(attributes, "value", "(?i:bearer)\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED_TOKEN]")
          - replace_all_patterns(attributes, "value", "\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{2,}\\b", "[REDACTED_JWT]")
          - replace_all_patterns(attributes, "value", "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}", "[REDACTED_PIX_EMAIL]")
          - replace_all_patterns(attributes, "value", "(?i:cpf)\\d{11}(?:\\b|_)", "CPF[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "(?:\\b|_)\\d{11}(?:\\b|_)", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "(?:\\b|_)\\d{11}(?:\\b|_)", "[REDACTED_CPF]")
          - replace_all_patterns(attributes, "value", "(?:\\+55\\s?[1-9]{2}\\s?(?:9\\d{8}|[2-5]\\d{7})\\b|(?:\\+?55\\s?)?\\([1-9]{2}\\)\\s?(?:9\\d{4}|[2-5]\\d{3})-?\\d{4}\\b|(?:\\+?55\\s?)?\\b[1-9]{2}\\s?(?:9\\d{4}|[2-5]\\d{3})-\\d{4}\\b)", "[REDACTED_PHONE]")
          - replace_all_patterns(attributes, "value", "(?i:(?:phone|telefone|celular|tel|fone)[\"'=:\\s]+)(?:\\+?55\\s?)?[1-9]{2}(?:9\\d{8}|[2-5]\\d{7})\\b", "phone=[REDACTED_PHONE]")
          - replace_all_patterns(attributes, "value", "(?i:(?:pix(?:_?key)?|chave_?pix|evp)[\"'=:\\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\\b", "pixKey=[REDACTED_PIX_EVP]")
          # Mask Random PIX Key (EVP) when sent directly in a PIX-named attribute (case-insensitive)
          - replace_pattern(attributes["pixKey"], "(?i:\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b)", "[REDACTED_PIX_EVP]") where attributes["pixKey"] != nil
          - replace_pattern(attributes["chave_pix"], "(?i:\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b)", "[REDACTED_PIX_EVP]") where attributes["chave_pix"] != nil
          - replace_pattern(attributes["evp"], "(?i:\\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b)", "[REDACTED_PIX_EVP]") where attributes["evp"] != nil
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

### 3.3 `apps/dashboard/nginx.conf.template` (Inyecta el `DASHBOARD_API_TOKEN` Segregado)
> **Regla crítica del entrypoint de `nginx:alpine`:** Debe definir `ENV NGINX_ENVSUBST_FILTER=^DASHBOARD_API_TOKEN$` en el `Dockerfile` de `apps/dashboard` (y en `environment:` de `docker-compose.yml` / `docker-compose.prod.yml`) para que `/docker-entrypoint.d/20-envsubst-on-templates.sh` sustituya **únicamente** `${DASHBOARD_API_TOKEN}` y deje intactas las variables nativas de Nginx (`$host`, `$remote_addr`, `$uri`).

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

## 4. Criterios de Aceptación
- [ ] `pnpm install --frozen-lockfile && pnpm run check:workspace` pasan en un checkout limpio mediante Nx.
- [ ] `docker compose up -d` lleva Prometheus, Loki, Tempo, Grafana y Collector al estado `healthy` en ≤ 90 s.
- [ ] Un log OTLP que contenga CPF (`123.456.789-00`), CNPJ (`12.345.678/0001-99`) y `Bearer eyJ...` en `body` se almacena en Loki con `[REDACTED_CPF]`, `[REDACTED_CNPJ]` y `Bearer [REDACTED_TOKEN]`.
- [ ] Grafana lista las 3 fuentes de datos sin errores y el punto de contacto utiliza `GRAFANA_WEBHOOK_TOKEN`.
- [ ] CI en verde en GitHub; sin secretos en el repositorio.
