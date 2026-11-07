# TECH 03 — Workload Logístico (`api-liquidacao-frete-pix`) e Repositório Alvo Dedicado (Fase 3)

**Depende de:** [01](./01_foundation_and_infrastructure.md)
**Objetivo:** construir o serviço `api-liquidacao-frete-pix` (liquidação instantânea de frete e manifesto de carga via PIX) instrumentado com OpenTelemetry no Docker Compose e publicar seu repositório-alvo dedicado (`https://github.com/AdmilsonGoncalves/zeromttr-target-pix-freight`) com as tags reais `v2.14.7` (saudável) e `v2.14.8` (regressão no pool de conexões).

## 1. Contextualização na Trilha Logística & Automação
Em operadores logísticos brasileiros, a liberação de manifesto eletrônico de carga depende da confirmação do adiantamento de frete via PIX para o motorista. O serviço `api-liquidacao-frete-pix` processa lotes de liquidação registrando transações no PostgreSQL.
- Na versão **`v2.14.7` (saudável)**, `PixSettlementRepository.ts` opera com pool adequado (`max: 10`) e libera rigorosamente cada cliente de conexão em um bloco `try { ... } finally { client.release() }`.
- Na versão **`v2.14.8` (degradada)**, um commit de refatoração (`perf(pix): inline settlement lock during manifest batch`) reduziu o pool para `max: 2` e omitiu `client.release()` quando ocorre retentativa de chave PIX, causando esgotamento de conexões (`KnexTimeoutError`), p95 > 4.5s e paralisação da expedição logística.

## 2. Arquitetura MVC em Camadas (`apps/target-app-demo/src/`)
```text
apps/target-app-demo/src/
  routes/        settlements.routes.ts, chaos.routes.ts, health.routes.ts
  controllers/   SettlementsController, ChaosController
  services/      PixSettlementService
  repositories/  PixSettlementRepository (Knex / pg)
  models/        freight-settlement.ts
  telemetry/     otel.ts (SDK traces+metrics+logs, exemplars)
  db/            knexfile.ts, migrations/
  app.ts, server.ts
```

## 3. Requisitos Funcionais do Contêiner Local
- `POST /settlements` (liquida adiantamento de frete via PIX para manifesto de carga), `GET /settlements/:id`, `GET /health`.
- `POST /chaos/pool-saturation?enable=true|false` alterna o modo de operação do `PixSettlementRepository` entre o comportamento da release `v2.14.7` (saudável) e o comportamento com regressão da release `v2.14.8` (somente com `CHAOS_ENABLED=true`).
- `GET /chaos/status` retorna:
  ```json
  {
    "status": "degraded",
    "service": "api-liquidacao-frete-pix",
    "version": "v2.14.8",
    "previousHealthyVersion": "v2.14.7",
    "targetRepo": "https://github.com/AdmilsonGoncalves/zeromttr-target-pix-freight",
    "suspectFilePath": "src/repositories/PixSettlementRepository.ts",
    "rawEdgeLogPreCollector": "ERROR [api-liquidacao-frete-pix] Pool exhausted settling freight manifest #MF-9042 for driver CPF 123.456.789-00 carrier CNPJ 12.345.678/0001-99 pixKey motorista.silva@translog.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
  }
  ```

## 4. Telemetria OpenTelemetry e Emissão de PII Sintética na Borda
- Resource attributes: `service.name=api-liquidacao-frete-pix` e `service.version` (`v2.14.7` quando saudável, `v2.14.8` quando degradado).
- Métricas exportadas via OTLP: `http_server_duration` (histograma com exemplars contendo `trace_id`), `db_pool_waiting`, `db_pool_used`.
- Spans com erro (`SpanStatusCode.ERROR`) na operação `pg.pool.acquire` / `PixSettlementRepository.settleManifestBatch`.
- Logs estruturados enviados via OTLP/HTTP (`http://otel-collector:4318`) contendo `trace_id`, `span_id` e dados sintéticos brasileiros no `body` (CPF de motorista, CNPJ de transportadora, chave PIX de e-mail e token Bearer JWT).
- O OTel Collector intercepta esse log na borda e aplica o processor **`transform/pii_logs` (OTTL `replace_pattern`)**, gravando no Loki apenas `[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `[REDACTED_PIX_EMAIL]` e `Bearer [REDACTED_TOKEN]`.

## 5. Repositório Alvo Dedicado (`zeromttr-target-pix-freight`) e Tags Reais (ADR-001)
Para evitar poluir o monorepo principal (`zeromttr`) com branches e Pull Requests abertos a cada execução e evitar conflito no CI principal:
1. Criar o repositório público dedicado **`https://github.com/AdmilsonGoncalves/zeromttr-target-pix-freight`**.
2. Fazer o commit da versão saudável de `src/repositories/PixSettlementRepository.ts` (com `finally { client.release() }` e teste de regressão `test/pix-settlement-pool.spec.ts` passando) e publicar a **tag Git real `v2.14.7`**.
3. Fazer o commit da regressão em `src/repositories/PixSettlementRepository.ts` (removendo a liberação de conexão no caminho de timeout) e publicar a **tag Git real `v2.14.8`** na branch principal do repositório-alvo.
4. Configurar no repositório-alvo o workflow `.github/workflows/hotfix-verify.yml`:
   - Dispara automaticamente quando o ZeroMTTR abre um Pull Request `hotfix/zeromttr-*`.
   - Roda `pnpm test` no repositório-alvo (validando que o patch gerado pelo ZeroMTTR corrigiu o vazamento de conexões do pool) e publica o comentário automático `✅ ZeroMTTR Autonomous CI Gate: PASSED` no PR.

## 6. Scripts Operacionais
- `scripts/chaos.sh`: ativa a degradação `v2.14.8` e gera carga concorrente de liquidação de fretes por 60 s.
- `scripts/reset.sh`: desativa a degradação no contêiner, limpa incidentes ativos e fecha automaticamente via GitHub API eventuais Pull Requests e branches `hotfix/zeromttr-*` abertos em execuções de demonstração anteriores no repositório `zeromttr-target-pix-freight`.

## 7. Critérios de Aceite
- [ ] Em condição normal (`v2.14.7`): p95 < 200 ms, sem erros.
- [ ] Com `chaos.sh` (`v2.14.8`): alerta do Grafana dispara em ≤ 90 s.
- [ ] As tags `v2.14.7` e `v2.14.8` existem no repositório `AdmilsonGoncalves/zeromttr-target-pix-freight`, e `GET /repos/AdmilsonGoncalves/zeromttr-target-pix-freight/compare/v2.14.7...v2.14.8` retorna o diff real da regressão em `src/repositories/PixSettlementRepository.ts`.
- [ ] Logs consultados no Loki pelo `trace_id` mostram CPF, CNPJ, chave PIX e Bearer mascarados pelo processor `transform` do Collector.
- [ ] `scripts/reset.sh` restaura o serviço para `healthy` e mantém o repositório-alvo limpo.
