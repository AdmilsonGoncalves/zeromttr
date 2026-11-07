# TECH 03 — Aplicação Alvo de Demonstração (`api-pagamentos-core`) e Estratégia de Tags/Branch (Fase 3)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** construir o serviço de demonstração `api-pagamentos-core` (`apps/target-app-demo`) instrumentado com OpenTelemetry no Docker Compose e estruturar no repositório `https://github.com/AdmilsonGoncalves/zeromttr` as tags reais `v2.14.7` (saudável na `master`) e `v2.14.8` (regressão no pool de conexões na branch `release/target-v2.14.8`).

## 1. Arquitetura Aberta e Domínio do Workload de Demonstração
Seguindo o princípio de **Robert C. Martin (*Clean Architecture*)** de **manter a arquitetura aberta e desacoplada de detalhes**, o **ZeroMTTR** não possui conhecimento acoplado sobre a regra de negócios do serviço monitorado: qualquer microsserviço (seja de liquidação PIX, expedição logística, faturamento ou e-commerce) conecta-se ao ZeroMTTR unicamente por emitir telemetria OTLP e possuir um repositório Git (`TARGET_GITHUB_REPO`).

Para a demonstração prática, utiliza-se o serviço **`api-pagamentos-core`** (processamento de transações PIX com PostgreSQL):
- Na versão **`v2.14.7` (saudável)**, `PaymentRepository.ts` opera com pool adequado (`max: 10`) e libera rigorosamente cada cliente de conexão em um bloco `try { ... } finally { client.release() }`.
- Na versão **`v2.14.8` (degradada)**, um commit de regressão (`perf(db): inline payment lock query on high concurrency`) reduziu o pool para `max: 2` e omitiu `client.release()` quando ocorre timeout na transação, causando esgotamento de conexões (`KnexTimeoutError`) e latência p95 > 4.5s.

## 2. Padrão MVC em Camadas (`apps/target-app-demo/src/`)
```text
apps/target-app-demo/src/
  routes/        payments.routes.ts, chaos.routes.ts, health.routes.ts
  controllers/   PaymentsController, ChaosController
  services/      PaymentService
  repositories/  PaymentRepository (Knex / pg)
  models/        payment.ts
  telemetry/     otel.ts (SDK traces+metrics+logs, exemplars)
  db/            knexfile.ts, migrations/
  app.ts, server.ts
```

## 3. Requisitos Funcionais do Contêiner Local
- `POST /payments` (processa transação PIX), `GET /payments/:id`, `GET /health`.
- `POST /chaos/pool-saturation?enable=true|false` alterna o modo de operação do `PaymentRepository` entre o comportamento da release `v2.14.7` (saudável) e o comportamento com regressão da release `v2.14.8` (somente com `CHAOS_ENABLED=true`).
- `GET /chaos/status` retorna:
  ```json
  {
    "status": "degraded",
    "service": "api-pagamentos-core",
    "version": "v2.14.8",
    "previousHealthyVersion": "v2.14.7",
    "targetRepo": "https://github.com/AdmilsonGoncalves/zeromttr",
    "suspectFilePath": "apps/target-app-demo/src/repositories/PaymentRepository.ts",
    "rawEdgeLogPreCollector": "ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
  }
  ```

## 4. Telemetria OpenTelemetry e Emissão de PII Sintética na Borda
- Resource attributes: `service.name=api-pagamentos-core` e `service.version` (`v2.14.7` quando saudável, `v2.14.8` quando degradado).
- Métricas exportadas via OTLP: `http_server_duration` (histograma com exemplars contendo `trace_id`), `db_pool_waiting`, `db_pool_used`.
- Spans com erro (`SpanStatusCode.ERROR`) na operação `pg.pool.acquire` / `PaymentRepository.createPayment`.
- Logs estruturados enviados via OTLP/HTTP (`http://otel-collector:4318`) contendo `trace_id`, `span_id` e dados sintéticos brasileiros no `body` (CPF, CNPJ, chave PIX de e-mail e token Bearer JWT).
- O OTel Collector intercepta esse log na borda e aplica o processor **`transform/pii_logs` (OTTL `replace_pattern`)**, gravando no Loki apenas `[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `[REDACTED_PIX_EMAIL]` e `Bearer [REDACTED_TOKEN]`.

## 5. Estratégia de Tags Reais (`v2.14.7` e `v2.14.8`) e Isolamento da `master` (ADR-001)
Para manter tudo dentro do único repositório **`https://github.com/AdmilsonGoncalves/zeromttr`** sem quebrar o CI da branch `master`:
1. Na branch **`master`**, `apps/target-app-demo/src/repositories/PaymentRepository.ts` permanece 100% saudável (com `finally { client.release() }` e teste de regressão `apps/target-app-demo/test/payment-pool.spec.ts` passando). Esse commit recebe a **tag Git real `v2.14.7`**.
2. A partir de `v2.14.7`, cria-se a branch dedicada **`release/target-v2.14.8`** contendo o commit real que introduz a regressão em `apps/target-app-demo/src/repositories/PaymentRepository.ts` (removendo a liberação de conexão no caminho de timeout e reduzindo o pool). Esse commit recebe a **tag Git real `v2.14.8`**.
3. Quando o ZeroMTTR atua:
   - `inspect_git_deploy_diff` compara as tags reais `v2.14.7...v2.14.8` filtrando `apps/target-app-demo`.
   - `create_remediation_pr` cria a branch `hotfix/zeromttr-<incident_id>` a partir de `release/target-v2.14.8`, aplica o patch restaurando o `PaymentRepository.ts` e abre o Pull Request contra `release/target-v2.14.8`.
   - O workflow `.github/workflows/hotfix-verify.yml` dispara automaticamente no PR, roda os testes do `apps/target-app-demo` e comenta `✅ ZeroMTTR Autonomous CI Gate: PASSED` no PR.

## 6. Scripts Operacionais
- `scripts/chaos.sh`: ativa a degradação `v2.14.8` e gera carga concorrente por 60 s.
- `scripts/reset.sh`: desativa a degradação no contêiner, limpa incidentes ativos e fecha automaticamente via GitHub API eventuais Pull Requests e branches `hotfix/zeromttr-*` abertos em execuções de demonstração anteriores.

## 7. Critérios de Aceite
- [ ] Em condição normal (`v2.14.7`): p95 < 200 ms, sem erros, e branch `master` 100% verde no CI.
- [ ] Com `chaos.sh` (`v2.14.8`): alerta do Grafana dispara em ≤ 90 s.
- [ ] As tags `v2.14.7` e `v2.14.8` existem no repositório `AdmilsonGoncalves/zeromttr`, e `GET /repos/AdmilsonGoncalves/zeromttr/compare/v2.14.7...v2.14.8` retorna o diff real da regressão em `apps/target-app-demo/src/repositories/PaymentRepository.ts`.
- [ ] Logs consultados no Loki pelo `trace_id` mostram CPF, CNPJ, chave PIX e Bearer mascarados pelo processor `transform` do Collector.
- [ ] `scripts/reset.sh` restaura o serviço para `healthy` e limpa PRs/branches `hotfix/zeromttr-*` anteriores.
