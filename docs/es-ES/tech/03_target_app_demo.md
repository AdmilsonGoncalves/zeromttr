# TECH 03 — Aplicación Demo Objetivo (`api-pagamentos-core`) y Estrategia de Etiquetas/Ramas (Fase 3)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** construir el servicio demo `api-pagamentos-core` (`apps/target-app-demo`) instrumentado con OpenTelemetry en Docker Compose, y estructurar en el repositorio `https://github.com/AdmilsonGoncalves/zeromttr` las etiquetas reales `v2.14.7` (saludable en `master`) y `v2.14.8` (regresión del pool de conexiones en la rama `release/target-v2.14.8`).

## 1. Arquitectura Abierta y Dominio de la Carga de Trabajo Demo
Siguiendo el principio de **Robert C. Martin (*Clean Architecture*)** de **mantener la arquitectura abierta y desacoplada de los detalles**, **ZeroMTTR** no posee ningún conocimiento acoplado sobre las reglas de negocio del servicio monitorizado: cualquier microservicio (ya sea liquidación PIX, despacho logístico, facturación o comercio electrónico) se conecta a ZeroMTTR únicamente emitiendo telemetría OTLP y disponiendo de un repositorio Git (`TARGET_GITHUB_REPO`).

Para la demostración práctica se utiliza el servicio **`api-pagamentos-core`** (procesamiento de transacciones PIX con PostgreSQL):
- En la versión **`v2.14.7` (saludable)**, `payment.repository.ts` opera con un pool adecuado (`max: 10`) y libera estrictamente cada cliente de conexión dentro de un bloque `try { ... } finally { client.release() }`.
- En la versión **`v2.14.8` (degradada)**, un commit de regresión (`perf(db): inline payment lock query on high concurrency`) redujo el pool a `max: 2` y omitió `client.release()` cuando ocurre un timeout de transacción, provocando el agotamiento de conexiones (`KnexTimeoutError`) y una latencia p95 > 4,5 s.

## 2. Patrón MVC en Capas (`apps/target-app-demo/src/`)
```text
apps/target-app-demo/src/
  routes/        payments.routes.ts, chaos.routes.ts, health.routes.ts
  controllers/   PaymentsController, ChaosController
  services/      PaymentService
  repositories/  payment.repository.ts (Knex / pg)
  models/        payment.ts
  telemetry/     otel.ts (SDK traces+metrics+logs, exemplars)
  db/            knexfile.ts, migrations/
  app.ts, server.ts
```

## 3. Requisitos Funcionales del Contenedor Local
- `POST /payments` (procesa una transacción PIX), `GET /payments/:id`, `GET /health`.
- `POST /chaos/pool-saturation?enable=true|false` alterna el modo de operación de `PaymentRepository` entre el comportamiento saludable de la versión `v2.14.7` y el comportamiento con regresión de la versión `v2.14.8` (solo cuando `CHAOS_ENABLED=true`).
- `GET /chaos/status` devuelve:
  ```json
  {
    "status": "degraded",
    "service": "api-pagamentos-core",
    "version": "v2.14.8",
    "previousHealthyVersion": "v2.14.7",
    "targetRepo": "https://github.com/AdmilsonGoncalves/zeromttr",
    "suspectFilePath": "apps/target-app-demo/src/repositories/payment.repository.ts",
    "rawEdgeLogPreCollector": "ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
  }
  ```

## 4. Telemetría OpenTelemetry y Emisión de PII Sintético en el Borde
- Atributos de recurso: `service.name=api-pagamentos-core` y `service.version` (`v2.14.7` cuando está saludable, `v2.14.8` cuando está degradado).
- Métricas exportadas mediante OTLP: `http_server_duration` (histograma con ejemplares que contienen `trace_id`), `db_pool_waiting`, `db_pool_used`.
- Spans de error (`SpanStatusCode.ERROR`) en la operación `pg.pool.acquire` / `PaymentRepository.createPayment`.
- Logs estructurados enviados mediante OTLP/HTTP (`http://otel-collector:4318`) que contienen `trace_id`, `span_id` y datos brasileños sintéticos en `body` (CPF, CNPJ, clave PIX de correo electrónico y token Bearer JWT).
- El campo `rawEdgeLogPreCollector` devuelto por `GET /chaos/status` es una muestra reportada por la aplicación del log exacto emitido antes de la transmisión OTLP al Collector (etiquetado claramente en la interfaz de usuario como *"App-Reported Pre-Collector Log"*), lo que permite la comparación visual entre la cadena emitida por la aplicación y el log persistido en Loki tras el procesador **`transform/pii_logs` (OTTL `replace_pattern`)**.

## 5. Estrategia de Etiquetas Reales (`v2.14.7` y `v2.14.8`), Orden de Creación y Protección de Ramas/Etiquetas (ADR-001)
Para mantener todo dentro del repositorio único **`https://github.com/AdmilsonGoncalves/zeromttr`** sin romper la CI en `master` y garantizando que `.github/workflows/hotfix-verify.yml` se active siempre:

1. **Orden de Creación Obligatorio (Al Final de la Fase 3):**
   - En GitHub Actions, un flujo de trabajo `on: pull_request: branches: [release/target-v2.14.8]` se ejecuta a partir del commit de fusión del PR contra la rama base (`release/target-v2.14.8`). Por lo tanto, **las etiquetas `v2.14.7` y `v2.14.8` y la rama `release/target-v2.14.8` DEBEN crearse únicamente al final de la Fase 3**, una vez que `.github/workflows/hotfix-verify.yml`, `pnpm-lock.yaml` y la suite de tests de regresión `apps/target-app-demo/test/payment-pool.spec.ts` ya estén implementados y pasando en `master`.
2. **Paso a Paso de Etiquetas y Ramas:**
   - En la rama **`master`**, `apps/target-app-demo/src/repositories/payment.repository.ts` permanece 100 % saludable (con `finally { client.release() }` y el test de regresión `apps/target-app-demo/test/payment-pool.spec.ts` pasando). Este commit recibe la **etiqueta Git real `v2.14.7`**.
   - A partir de `v2.14.7`, crear la rama dedicada **`release/target-v2.14.8`** (que hereda `.github/workflows/hotfix-verify.yml`, `pnpm-lock.yaml` y `payment-pool.spec.ts`) con el commit real que introduce la regresión en `apps/target-app-demo/src/repositories/payment.repository.ts` (eliminando la liberación de la conexión en la ruta de timeout y reduciendo el pool). Este commit recibe la **etiqueta Git real `v2.14.8`**.
3. **Endurecimiento de Seguridad en GitHub (Ruleset de Protección de Ramas y Etiquetas sin Bypass de Administrador):**
   - Dado que el `GITHUB_TOKEN` (Fine-Grained PAT con alcance limitado a `AdmilsonGoncalves/zeromttr`) configurado en el VPS pertenece al administrador del repositorio y cuenta con `Contents: Read & Write` para crear ramas `hotfix/zeromttr-*`, habilitar en la configuración del repositorio de GitHub:
     - **Protección de Rama / Ruleset en `master` incluyendo Administradores:** bloquear *force push*, eliminación y pushes directos sin PR, marcando obligatoriamente ***"Do not allow bypassing the above settings"*** (o manteniendo la *Bypass list* vacía en el Ruleset) y verificando en la práctica que un `git push` directo a `master` usando el PAT del VPS sea rechazado;
     - **Ruleset de Protección de Etiquetas para `v2.14.*` (sin Bypass):** impedir la eliminación o sobrescritura de las etiquetas de referencia `v2.14.7` y `v2.14.8`.
4. **Ciclo de Acción de ZeroMTTR:**
   - `inspect_git_deploy_diff` compara las etiquetas reales `v2.14.7...v2.14.8` filtrando `apps/target-app-demo`.
   - `create_remediation_pr` crea la rama `hotfix/zeromttr-<incident_id>` desde `release/target-v2.14.8`, aplica el parche que restaura `payment.repository.ts` y abre el Pull Request contra `release/target-v2.14.8`.
   - El flujo de trabajo `.github/workflows/hotfix-verify.yml` se activa automáticamente en el PR, ejecuta los tests de `apps/target-app-demo` y comenta `✅ ZeroMTTR Autonomous CI Gate: PASSED` en el PR.

## 6. Scripts Operativos
- `scripts/chaos.sh`: habilita la degradación `v2.14.8` y genera carga concurrente durante 60 s.
- `scripts/reset.sh`: deshabilita la degradación en el contenedor, limpia los incidentes activos y cierra automáticamente mediante la API de GitHub cualquier Pull Request y rama `hotfix/zeromttr-*` abierta en ejecuciones de demostración anteriores.

## 7. Criterios de Aceptación
- [ ] En condiciones normales (`v2.14.7`): p95 < 200 ms, cero errores y rama `master` 100 % en verde en CI.
- [ ] Con `chaos.sh` (`v2.14.8`): la alerta de Grafana se dispara en ≤ 90 s.
- [ ] Las etiquetas `v2.14.7` y `v2.14.8` existen en el repositorio `AdmilsonGoncalves/zeromttr`, y `GET /repos/AdmilsonGoncalves/zeromttr/compare/v2.14.7...v2.14.8` devuelve el diff real de regresión en `apps/target-app-demo/src/repositories/payment.repository.ts`.
- [ ] Los logs consultados en Loki por `trace_id` muestran CPF, CNPJ, clave PIX y Bearer enmascarados por el procesador `transform` del Collector.
- [ ] `scripts/reset.sh` restaura el servicio a `healthy` y limpia los PRs/ramas `hotfix/zeromttr-*` anteriores.
