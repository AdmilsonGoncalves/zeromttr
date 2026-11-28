# TECH 03 — Target Demo Application (`api-pagamentos-core`) and Tag/Branch Strategy (Phase 3)

**Depends on:** [01](./01_foundation_and_infrastructure.md)
**Objective:** build the `api-pagamentos-core` demo service (`apps/target-app-demo`) instrumented with OpenTelemetry in Docker Compose, and structure in the `https://github.com/AdmilsonGoncalves/zeromttr` repository the real tags `v2.14.7` (healthy on `master`) and `v2.14.8` (connection pool regression on the `release/target-v2.14.8` branch).

## 1. Open Architecture and Demo Workload Domain
Following **Robert C. Martin's (*Clean Architecture*)** principle of **keeping the architecture open and decoupled from details**, **ZeroMTTR** holds no coupled knowledge about the business rules of the monitored service: any microservice (whether PIX settlement, logistics dispatch, billing, or e-commerce) connects to ZeroMTTR solely by emitting OTLP telemetry and having a Git repository (`TARGET_GITHUB_REPO`).

For the practical demonstration, the **`api-pagamentos-core`** service (PIX transaction processing with PostgreSQL) is used:
- On version **`v2.14.7` (healthy)**, `payment.repository.ts` operates with an adequate pool (`max: 10`) and strictly releases each connection client inside a `try { ... } finally { client.release() }` block.
- On version **`v2.14.8` (degraded)**, a regression commit (`perf(db): inline payment lock query on high concurrency`) reduced the pool to `max: 2` and omitted `client.release()` when a transaction timeout occurs, causing connection exhaustion (`KnexTimeoutError`) and p95 latency > 4.5s.

## 2. Layered MVC Pattern (`apps/target-app-demo/src/`)
```text
apps/target-app-demo/src/
  routes/        payments.routes.ts, ops.routes.ts, chaos.routes.ts, health.routes.ts
  controllers/   PaymentsController, OpsStatusController, ChaosController
  services/      PaymentService
  repositories/  payment.repository.ts (Knex / pg)
  models/        payment.ts
  telemetry/     otel.ts (SDK traces+metrics+logs, exemplars)
  db/            knexfile.ts, migrations/
  app.ts, server.ts
```

## 3. Local Container Functional Requirements
- `POST /payments` (processes PIX transaction), `GET /payments/:id`, `GET /health`.
- `POST /chaos/pool-saturation?enable=true|false` toggles `PaymentRepository` operation mode between the healthy `v2.14.7` release behavior and the regressed `v2.14.8` release behavior (when `CHAOS_AUTO_TRAFFIC_BURST=true`, also triggers synthetic traffic burst waves).
- `POST /chaos/healthy-traffic?enable=true|false` starts or stops continuous healthy traffic (interval configurable via `HEALTHY_TRAFFIC_INTERVAL_MS`, default `1500` ms, with optional boot auto-start via `HEALTHY_TRAFFIC_AUTO_START=true`).
- `GET /ops/status` (with backward-compatible `GET /chaos/status` delegating to the same manifest builder) returns the neutral operational manifest with `capabilities` and generic `saturation`:
  ```json
  {
    "status": "degraded",
    "service": "api-pagamentos-core",
    "version": "v2.14.8",
    "previousHealthyVersion": "v2.14.7",
    "targetRepo": "https://github.com/AdmilsonGoncalves/zeromttr",
    "suspectFilePath": "apps/target-app-demo/src/repositories/payment.repository.ts",
    "capabilities": {
      "chaosSimulation": true,
      "healthyTrafficToggle": true
    },
    "rawEdgeLogPreCollector": "ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "metrics": {
      "requestsPerSecond": 12.4,
      "errorRate5xxPercent": 80,
      "p95LatencyMs": 4610,
      "healthyTrafficActive": false,
      "saturation": {
        "resourceLabel": "DB Pool",
        "active": 2,
        "waiting": 8,
        "max": 2
      }
    }
  }
  ```

## 4. OpenTelemetry Telemetry and Synthetic Edge PII Emission
- Resource attributes: `service.name=api-pagamentos-core` and `service.version` (`v2.14.7` when healthy, `v2.14.8` when degraded).
- Metrics exported via OTLP: `http_server_duration` (histogram with exemplars containing `trace_id`), `db_pool_waiting`, `db_pool_used`.
- Error spans (`SpanStatusCode.ERROR`) on the `pg.pool.acquire` / `PaymentRepository.createPayment` operation.
- Structured logs sent via OTLP/HTTP (`http://otel-collector:4318`) containing `trace_id`, `span_id`, and synthetic Brazilian data in `body` (CPF, CNPJ, email PIX key, and Bearer JWT token).
- The `rawEdgeLogPreCollector` field returned by `GET /ops/status` (and legacy `GET /chaos/status`) is an application-reported sample of the exact log emitted before OTLP transmission to the Collector (clearly labeled in the UI as *"App-Reported Pre-Collector Log"*), allowing visual comparison between the string emitted by the application and the log persisted in Loki after the **`transform/pii_logs` (OTTL `replace_pattern`)** processor.

## 5. Real Tag Strategy (`v2.14.7` and `v2.14.8`), Creation Order, and Branch/Tag Protection (ADR-001)
To keep everything inside the single **`https://github.com/AdmilsonGoncalves/zeromttr`** repository without breaking CI on `master` and ensuring `.github/workflows/hotfix-verify.yml` always triggers:

1. **Mandatory Creation Order (At the End of Phase 3):**
   - In GitHub Actions, an `on: pull_request: branches: [release/target-v2.14.8]` workflow runs from the PR merge commit against the base branch (`release/target-v2.14.8`). Therefore, **the `v2.14.7` and `v2.14.8` tags and the `release/target-v2.14.8` branch MUST only be created at the end of Phase 3**, once `.github/workflows/hotfix-verify.yml`, `pnpm-lock.yaml`, and the regression test suite `apps/target-app-demo/test/payment-pool.spec.ts` are already implemented and passing on `master`.
2. **Tag and Branch Step-by-Step:**
   - On the **`master`** branch, `apps/target-app-demo/src/repositories/payment.repository.ts` remains 100% healthy (with `finally { client.release() }` and regression test `apps/target-app-demo/test/payment-pool.spec.ts` passing). This commit receives the **real Git tag `v2.14.7`**.
   - From `v2.14.7`, create the dedicated branch **`release/target-v2.14.8`** (which inherits `.github/workflows/hotfix-verify.yml`, `pnpm-lock.yaml`, and `payment-pool.spec.ts`) containing the real commit that introduces the regression in `apps/target-app-demo/src/repositories/payment.repository.ts` (removing connection release on the timeout path and shrinking the pool). This commit receives the **real Git tag `v2.14.8`**.
3. **GitHub Security Hardening (Branch & Tag Protection Ruleset without Admin Bypass):**
   - Because the `GITHUB_TOKEN` (Fine-Grained PAT scoped to `AdmilsonGoncalves/zeromttr`) configured on the VPS belongs to the repository administrator and has `Contents: Read & Write` to create `hotfix/zeromttr-*` branches, enable in the GitHub repository settings:
     - **Branch Protection / Ruleset on `master` including Administrators:** block *force push*, deletion, and direct pushes without a PR, mandatorily checking ***"Do not allow bypassing the above settings"*** (or keeping the *Bypass list* empty in the Ruleset) and verifying in practice that a direct `git push` to `master` using the VPS PAT is rejected;
     - **Tag Protection Ruleset for `v2.14.*` (without Bypass):** prevent deletion or overwriting of baseline tags `v2.14.7` and `v2.14.8`.
4. **ZeroMTTR Action Cycle:**
   - `inspect_git_deploy_diff` compares the real tags `v2.14.7...v2.14.8` filtering `apps/target-app-demo`.
   - `create_remediation_pr` creates branch `hotfix/zeromttr-<incident_id>` from `release/target-v2.14.8`, applies the patch restoring `payment.repository.ts`, and opens the Pull Request against `release/target-v2.14.8`.
   - The `.github/workflows/hotfix-verify.yml` workflow triggers automatically on the PR, runs `apps/target-app-demo` tests, and comments `✅ ZeroMTTR Autonomous CI Gate: PASSED` on the PR.

## 6. Operational Scripts
- `scripts/chaos.sh`: enables `v2.14.8` degradation and generates concurrent load for 60 s.
- `scripts/reset.sh`: disables degradation in the container, clears active incidents, and automatically closes via the GitHub API any Pull Requests and `hotfix/zeromttr-*` branches opened in previous demo runs.

## 7. Acceptance Criteria
- [ ] Under normal conditions (`v2.14.7`): p95 < 200 ms, zero errors, and `master` branch 100% green on CI.
- [ ] With `chaos.sh` (`v2.14.8`): Grafana alert fires in ≤ 90 s.
- [ ] Tags `v2.14.7` and `v2.14.8` exist in the `AdmilsonGoncalves/zeromttr` repository, and `GET /repos/AdmilsonGoncalves/zeromttr/compare/v2.14.7...v2.14.8` returns the real regression diff in `apps/target-app-demo/src/repositories/payment.repository.ts`.
- [ ] Logs queried in Loki by `trace_id` show CPF, CNPJ, PIX key, and Bearer masked by the Collector's `transform` processor.
- [ ] `scripts/reset.sh` restores the service to `healthy` and cleans up previous `hotfix/zeromttr-*` PRs/branches.
