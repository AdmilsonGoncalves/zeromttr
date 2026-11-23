# ADR-004: LLM Isolation behind `ReasoningPort`, `PiiPromptGuard` (Fail-Closed), and Deterministic Fallback

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

External language models introduce three operational risks during critical incidents: (1) accidental leakage of sensitive data (PII/LGPD or secrets) in the prompt, (2) provider API unavailability, latency, or quota exhaustion, and (3) responses outside the expected structured format.

## Decision

1. Isolate the AI provider behind the **`ReasoningPort`** interface (`apps/orchestrator/src/ports/reasoning.port.ts`), implemented in production by `GeminiReasoningAdapter` (`apps/orchestrator/src/adapters/llm.gemini.ts`).
2. Mandatory execution of **`PiiPromptGuard`** in **fail-closed** mode before any dispatch to the LLM. If any residual pattern for CPF/CNPJ (validated via Modulo-11), phone number (ANATEL rules), unquoted standard email (`[A-Za-z0-9._%+-]+@domain`, not covering RFC 5322 *quoted local parts* such as addresses with spaces), PIX EVP key (UUID v4 in PIX context), or JWT/Bearer token is found, the LLM call is aborted immediately.
3. Provide **`FallbackReasoningAdapter`** (`apps/orchestrator/src/adapters/llm.fallback.ts`) to keep deterministic diagnosis operational if the LLM fails, times out, or has no configured credential, transparently recording `reasoningSource: 'llm' | 'fallback'` in the incident, SSE, and PR.

## Consequences

### Positive

- Guarantees defense-in-depth for LGPD even if a message escapes edge sanitization.
- Eliminates a single point of failure on the external AI API without masking the reasoning origin (`reasoningSource`).

### Trade-offs

- Fallback mode produces more generic structured diagnoses when no LLM is available.
- Free-text proper names or technical identifiers not covered by deterministic rules (e.g., `request_id`) are outside the scope of `PiiPromptGuard`.

## Rejected Alternatives

- **Calling the Gemini SDK directly in the workflow without a guard:** would create PII leakage risk and tight coupling to the provider.
- **Aborting the incident on LLM error without fallback:** would reduce operational resilience during external API outages.

## Code References

- `apps/orchestrator/src/ports/reasoning.port.ts`
- `apps/orchestrator/src/adapters/llm.gemini.ts`
- `apps/orchestrator/src/adapters/llm.fallback.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.patterns.ts`
