# ADR-004: Aislamiento del LLM tras `ReasoningPort`, `PiiPromptGuard` (Fail-Closed) y respaldo determinista

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

Los modelos de lenguaje externos introducen tres riesgos operativos durante incidentes críticos: (1) fuga accidental de datos sensibles (PII/LGPD o secretos) en el prompt, (2) indisponibilidad de la API del proveedor, latencia o agotamiento de cuota, y (3) respuestas fuera del formato estructurado esperado.

## Decisión

1. Aislar al proveedor de IA tras la interfaz **`ReasoningPort`** (`apps/orchestrator/src/ports/reasoning.port.ts`), implementada en producción por `GeminiReasoningAdapter` (`apps/orchestrator/src/adapters/llm.gemini.ts`).
2. Ejecución obligatoria de **`PiiPromptGuard`** en modo **fail-closed** antes de cualquier envío al LLM. Si se detecta cualquier patrón residual de CPF/CNPJ (validado mediante Módulo-11), número de teléfono (reglas de ANATEL), correo electrónico estándar sin comillas (`[A-Za-z0-9._%+-]+@domain`, excluyendo *quoted local parts* de RFC 5322 como direcciones con espacios, direcciones `@users.noreply.github.com` y cadenas estilo SSH como `git@host:`), clave PIX EVP (UUID v4 en contexto PIX) o token JWT/Bearer, la llamada al LLM se aborta de inmediato.
3. Proveer **`FallbackReasoningAdapter`** (`apps/orchestrator/src/adapters/llm.fallback.ts`) para mantener operativo el diagnóstico determinista si el LLM falla, agota el tiempo de espera o no dispone de credencial configurada, registrando de forma transparente `reasoningSource: 'llm' | 'fallback'` en el incidente, el SSE y la PR.

## Consecuencias

### Positivas

- Garantiza defensa en profundidad para la LGPD incluso si algún mensaje escapa a la sanitización en el borde.
- Elimina el punto único de fallo sobre la API externa de IA sin ocultar el origen del razonamiento (`reasoningSource`).

### Compromisos

- El modo de respaldo produce diagnósticos estructurados más genéricos cuando no hay un LLM disponible.
- Los nombres propios en texto libre o identificadores técnicos no cubiertos por reglas deterministas (p. ej., `request_id`) quedan fuera del alcance de `PiiPromptGuard`.

## Alternativas descartadas

- **Llamar directamente al SDK de Gemini en el flujo de trabajo sin guarda:** generaría riesgo de fuga de PII y un fuerte acoplamiento al proveedor.
- **Abortar el incidente ante un error del LLM sin respaldo:** reduciría la resiliencia operativa durante caídas de la API externa.

## Referencias de código

- `apps/orchestrator/src/ports/reasoning.port.ts`
- `apps/orchestrator/src/adapters/llm.gemini.ts`
- `apps/orchestrator/src/adapters/llm.fallback.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.patterns.ts`
