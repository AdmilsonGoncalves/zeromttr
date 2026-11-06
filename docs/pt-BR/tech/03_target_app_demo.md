# TECH 03 — Aplicação Alvo de Demonstração (Fase 3)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** serviço `api-pagamentos-core` instrumentado com OTel, com uma falha **reproduzível sob comando** (saturação do pool de conexões induzida na versão `v2.14.8`), alvo da inspeção de diff e do Pull Request de hotfix autônomo.

## 1. Padrão: MVC em camadas
```text
apps/target-app-demo/src/
  routes/        payments.routes.ts, chaos.routes.ts, health.routes.ts
  controllers/   PaymentsController, ChaosController
  services/      PaymentService
  repositories/  PaymentRepository (Knex)
  models/        payment.ts
  telemetry/     otel.ts (SDK traces+metrics+logs, exemplars)
  chaos/         pool-saturation.ts
  db/            knexfile.ts, migrations/
  app.ts, server.ts
```

## 2. Requisitos funcionais
- `POST /payments` (cria pagamento), `GET /payments/:id`, `GET /health`.
- `POST /chaos/pool-saturation?enable=true|false` ativa o defeito (somente com `CHAOS_ENABLED=true`).
- `GET /chaos/status` retorna `{ status: 'healthy' | 'degraded', version: string, previousHealthyVersion: string, lastRawUnredactedLogSample?: string }` (ex.: `version: 'v2.14.8'`, `previousHealthyVersion: 'v2.14.7'`), usado por `GET /api/target/status` e `InvestigateIncident` no orquestrador, garantindo que a correlação de deploy e a prova visual de PII funcionem tanto via botão do Dashboard quanto via `scripts/chaos.sh`.
- Pool Knex deliberadamente pequeno (ex.: `min:0,max:2`, `acquireConnectionTimeout` baixo) e conexão retida/query lenta (`pg_sleep`) sob chaos → fila de conexões, latência alta, `KnexTimeoutError`.
- **O defeito deve ter correção localizada e determinística no código** (ex.: `apps/target-app-demo/src/chaos/pool-saturation.ts` ou `PaymentRepository.ts` onde a conexão não é liberada em um `try` sem `finally` e o pool está subdimensionado), permitindo que o agente gere o patch exato e que a suíte de regressão no CI valide a correção.
- Testes unitários do `PaymentService` e `PaymentRepository` já existentes.

## 3. Telemetria
- Resource `service.name=api-pagamentos-core` e `service.version` (`v2.14.7` em estado saudável e `v2.14.8` quando a anomalia está ativa), para o RCA correlacionar a anomalia com o deploy via `inspect_git_deploy_diff`.
- Métricas: `http_server_duration` (histograma com exemplars), `db_pool_waiting`, `db_pool_used`.
- Logs JSON com `trace_id`, `span_id` e `service_name`.
- Inclusão **intencional** de PII sintética no log de falha (ex.: `User CPF 123.456.789-00 failed checkout with token Bearer eyJhbGci...`) para demonstrar a redaction pelo OTel Collector. Essa última string bruta é exposta em `GET /chaos/status` (`lastRawUnredactedLogSample`) ao orquestrador (apenas para exibição didática do comparativo **"Antes vs. Depois da Sanitização de PII"** no War Room Dashboard, sem jamais enviá-la ao LLM).
- Exporter **OTLP/HTTP** para `http://otel-collector:4318` (`OTEL_EXPORTER_OTLP_ENDPOINT`).

## 4. Repositório alvo do Hotfix Autônomo (ADR-009)
Decisão consolidada (ADR-009): usar o próprio monorepo público **`https://github.com/AdmilsonGoncalves/zeromttr`**, diretório `apps/target-app-demo/`.
- Isso permite que todo Pull Request aberto pela tool `create_remediation_pr` na branch `hotfix/zeromttr-<incident_id>` dispare automaticamente o workflow `.github/workflows/hotfix-verify.yml` e receba o comentário de certificação da CI diretamente no repositório principal.
- `TARGET_GITHUB_REPO` (`https://github.com/AdmilsonGoncalves/zeromttr`) e `TARGET_SERVICE_PATH` (`apps/target-app-demo`) parametrizam as tools `inspect_git_deploy_diff` e `create_remediation_pr`.

## 5. Scripts
- `scripts/chaos.sh`: liga o chaos e gera carga (`autocannon`/`k6`) por 60 s.
- `scripts/reset.sh`: desliga chaos e limpa estado.

## 6. Critérios de aceite
- [ ] Em condição normal: p95 < 200 ms, sem erros.
- [ ] Com `chaos.sh`: alerta do Grafana dispara em ≤ 90 s.
- [ ] Trace de erro aparece no Tempo com span de DB longo (`pg.pool.acquire`) e status ERROR.
- [ ] Logs no Loki têm `trace_id` (derived field leva ao Tempo); PII aparece **redigida**.
- [ ] Exemplar com `trace_id` é retornado por `query_exemplars` no Prometheus.
- [ ] `pnpm --filter @zeromttr/target-app-demo test` passa e o defeito é coberto por um teste de regressão que valida a liberação de conexões do pool.
