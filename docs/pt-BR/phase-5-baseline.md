# Fase 5 — Hardening & Baseline (MTTR, FinOps e LGTM)

Este documento registra as medições executadas no ambiente local com os scripts da Fase 5 (`measure-mttr.sh`, `load-test-lgtm.sh`, `smoke-phase1.sh` e `record-replay.sh`).

## 1. Protocolo de Baseline Manual vs. ZeroMTTR

De acordo com o documento técnico [07_demo_and_delivery.md](./tech/07_demo_and_delivery.md), o baseline manual de resposta ao incidente de saturação de pool (`v2.14.8`) envolve 7 etapas executadas por um operador humano:

1. Receber o alerta e localizar o dashboard de latência no Grafana.
2. Consultar métricas de pool no Prometheus.
3. Buscar trace exemplars ou TraceQL no Tempo e identificar o span crítico.
4. Consultar logs no Loki para correlacionar `KnexTimeoutError`.
5. Comparar `v2.14.7...v2.14.8` no GitHub para identificar a regressão em `payment.repository.ts`.
6. Redigir e abrir o Pull Request de hotfix manualmente.
7. Escrever e enviar o resumo de post-mortem para aprovação.

| Modo de Execução | TTD (`RECEIVED -> REMEDIATING`) | TTPR (`RECEIVED -> AWAITING_PR`) | Post-Mortem (`RECEIVED -> NOTIFIED`) | Redução FinOps | PII Guard |
| --- | --- | --- | --- | --- | --- |
| **Replay dourado** (`inc-live-demo-golden-1795134557970-1`) | `11.51s` (meta `<= 15s`) | `14.51s` (meta `<= 30s`) | `19.51s` (meta `<= 45s`) | `94%` (`11328` tokens) | `passed: true` |
| **Live LGTM local** (`inc-d7a8aa3e`, sem `GITHUB_TOKEN`/`GEMINI_API_KEY`) | `1.03s` (meta `<= 15s`) | `1.06s` (meta `<= 30s`) | `n/a` (terminou em `FAILED` no `create_remediation_pr` com `401 Unauthorized`) | `66.14%` (`5014` tokens) | `passed: true` |

> Nota sobre o teste live (`inc-d7a8aa3e`): o pipeline LGTM completo (Grafana Alerting `for: 10s` → Orchestrator → Tempo/Loki/Prometheus → Anotação Grafana `id=13` → edge redaction 100%) operou em modo fallback determinístico porque `.env` não possuía `GITHUB_TOKEN` nem `GEMINI_API_KEY` configurados no momento da coleta. Além disso, a investigação live revelou que o Tempo `/api/search` pode omitir zeros à esquerda em `traceID`, motivando o zero-padding de 32 caracteres hexadecimais no `TempoHttpAdapter`.

## 2. Estabilidade LGTM sob Carga (`load-test-lgtm.sh`)

Parâmetros executados: `10` workers concorrentes por `20s` contra `target-app-demo` com `GOMEMLIMIT=200MiB` aplicado no `otel-collector`:

- **Histograma Prometheus (`http_request_duration_seconds_bucket`)**: `1462` observações registradas (9 buckets com exemplars).
- **Memória `zeromttr-otel-collector`**: `91.77MiB` (reduzido de `274.7MiB` antes de `GOMEMLIMIT=200MiB`).
- **Memória agregada dos 10 contêineres `zeromttr-*`**: `986.8 MiB` (`<= 2200 MiB`, zero OOMKills).
- **Sanitização OTTL na borda (`smoke-phase1.sh`)**: todos os padrões de CPF, CNPJ, e-mail PIX e Bearer JWT mascarados antes da persistência no Loki.

## 3. Comandos de Verificação

```bash
./scripts/smoke-phase1.sh
./scripts/load-test-lgtm.sh
./scripts/measure-mttr.sh <incident-id>
./scripts/record-replay.sh <incident-id>
```
