# Phase 5 — Hardening & Baseline (MTTR, FinOps, and LGTM)

This document records the measurements executed in the local environment using the Phase 5 scripts (`measure-mttr.sh`, `load-test-lgtm.sh`, `smoke-phase1.sh`, and `record-replay.sh`).

## 1. Manual Baseline vs. ZeroMTTR Protocol

According to the technical document [07_demo_and_delivery.md](./tech/07_demo_and_delivery.md), the manual response baseline for the pool saturation incident (`v2.14.8`) involves 7 steps executed by a human operator:

1. Receive the alert and locate the latency dashboard in Grafana.
2. Query pool metrics in Prometheus.
3. Search for trace exemplars or TraceQL in Tempo and identify the critical span.
4. Query logs in Loki to correlate `KnexTimeoutError`.
5. Compare `v2.14.7...v2.14.8` on GitHub to identify the regression in `payment.repository.ts`.
6. Manually write and open the hotfix Pull Request.
7. Write and send the post-mortem summary for approval.

| Execution Mode | TTD (`RECEIVED -> REMEDIATING`) | TTPR (`RECEIVED -> AWAITING_PR`) | Post-Mortem (`RECEIVED -> NOTIFIED`) | FinOps Reduction | PII Guard |
| --- | --- | --- | --- | --- | --- |
| **Golden replay** (`inc-live-demo-golden-1795134557970-1`) | `11.51s` (target `<= 15s`) | `14.51s` (target `<= 30s`) | `19.51s` (target `<= 45s`) | `94%` (`11328` tokens) | `passed: true` |
| **Local live LGTM** (`inc-d7a8aa3e`, without `GITHUB_TOKEN`/`GEMINI_API_KEY`) | `1.03s` (target `<= 15s`) | `1.06s` (target `<= 30s`) | `n/a` (ended in `FAILED` at `create_remediation_pr` with `401 Unauthorized`) | `66.14%` (`5014` tokens) | `passed: true` |

> Note on the live test (`inc-d7a8aa3e`): the complete LGTM pipeline (Grafana Alerting `for: 10s` → Orchestrator → Tempo/Loki/Prometheus → Grafana Annotation `id=13` → 100% edge redaction) operated in deterministic fallback mode because `.env` had neither `GITHUB_TOKEN` nor `GEMINI_API_KEY` configured at collection time. Additionally, the live investigation revealed that Tempo `/api/search` may omit leading zeros in `traceID`, motivating 32-hex-character zero-padding in `TempoHttpAdapter`.

## 2. LGTM Stability Under Load (`load-test-lgtm.sh`)

Executed parameters: `10` concurrent workers for `20s` against `target-app-demo` with `GOMEMLIMIT=200MiB` applied to `otel-collector`:

- **Prometheus histogram (`http_request_duration_seconds_bucket`)**: `1462` observations recorded (9 buckets with exemplars).
- **`zeromttr-otel-collector` memory**: `91.77MiB` (reduced from `274.7MiB` before `GOMEMLIMIT=200MiB`).
- **Aggregate memory across the 10 `zeromttr-*` containers**: `986.8 MiB` (`<= 2200 MiB`, zero OOMKills).
- **Edge OTTL sanitization (`smoke-phase1.sh`)**: all CPF, CNPJ, PIX email, and Bearer JWT patterns masked before persistence in Loki.

## 3. Verification Commands

```bash
./scripts/smoke-phase1.sh
./scripts/load-test-lgtm.sh
./scripts/measure-mttr.sh <incident-id>
./scripts/record-replay.sh <incident-id>
```
