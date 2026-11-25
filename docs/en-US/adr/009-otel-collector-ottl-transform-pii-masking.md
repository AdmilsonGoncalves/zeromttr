# ADR-009: Edge PII Masking via `transform` Processor (OTTL) in the OTel Collector

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Logs emitted by critical applications frequently contain personal data protected by LGPD (CPF, CNPJ, phone numbers, emails, PIX keys) or credentials (`Authorization: Bearer <jwt>`). Masking these data only when calling the LLM would leave PII written in plaintext in Loki and visible in operational dashboards.

## Decision

Apply PII masking **at the ingestion edge**, directly in the **OpenTelemetry Collector** (`infra/otel-collector-config.yaml` and `infra/otel-collector-config.prod.yaml`), using the **`transform`** processor with OTTL `replace_pattern` expressions over `body` and log attributes before exporting to Loki.

This primary barrier is complemented in the reasoning layer by the second deterministic, *fail-closed* barrier (**`PiiPromptGuard`**, ADR-004), which blocks LLM dispatch if any of the supported deterministic patterns (Modulo-11 CPF/CNPJ, phone numbers with area code per ANATEL rules, standard email format `[A-Za-z0-9._%+-]+@domain`, PIX EVP key in PIX context, and JWT/Bearer tokens) escape the edge. Formats outside this scope—such as map-valued structured log bodies (since `replace_pattern(body, ...)` in `transform/pii_logs` operates only on string `body` and string attributes), email *quoted local parts*, phone numbers without area codes, or free-text proper names—are not masked before export to Loki and may pass through the guard.

## Consequences

### Positive

- Sensitive data is redacted (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `[REDACTED_PIX_EMAIL]`, `[REDACTED_PHONE]`, `[REDACTED_PIX_EVP]`, `[REDACTED_JWT]`, `Bearer [REDACTED_TOKEN]`) before disk persistence in Loki.
- No monitored application needs to implement proprietary sanitization libraries to benefit from the protection.

### Trade-offs

- OTTL regular expressions in the Collector operate by syntactic matching and do not execute Modulo-11 check-digit validation (that refined validation runs in `PiiPromptGuard`).
- The `transform` processor adds minor CPU/RAM overhead in the Collector, mitigated with `GOMEMLIMIT=200MiB` and `memory_limiter`.

## Rejected Alternatives

- **Sanitizing only in the target application's code:** would violate the platform's agnostic design and require modifying every monitored microservice.
- **Sanitizing only in `orchestrator`:** would leave unmasked PII persisted in Loki.

## Code References

- `infra/otel-collector-config.yaml`
- `infra/otel-collector-config.prod.yaml`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `scripts/smoke-phase1.sh`
