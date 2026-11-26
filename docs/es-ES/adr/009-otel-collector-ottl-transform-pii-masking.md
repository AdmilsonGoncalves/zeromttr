# ADR-009: Enmascaramiento de PII en el borde mediante procesador `transform` (OTTL) en el OTel Collector

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

Los logs emitidos por aplicaciones críticas contienen con frecuencia datos personales protegidos por la LGPD (CPF, CNPJ, números de teléfono, correos electrónicos, claves PIX) o credenciales (`Authorization: Bearer <jwt>`). Enmascarar estos datos solo al llamar al LLM dejaría los PII escritos en texto plano en Loki y visibles en los paneles operativos.

## Decisión

Aplicar el enmascaramiento de PII **en el borde de ingestión**, directamente en el **OpenTelemetry Collector** (`infra/otel-collector-config.yaml` e `infra/otel-collector-config.prod.yaml`), utilizando el procesador **`transform`** con expresiones OTTL `replace_pattern` sobre `body` y atributos de log antes de exportar hacia Loki.

Esta barrera primaria se complementa en la capa de razonamiento con la segunda barrera determinista y *fail-closed* (**`PiiPromptGuard`**, ADR-004), que bloquea el envío al LLM si alguno de los patrones deterministas soportados (CPF/CNPJ con Módulo-11, números de teléfono con código de área según reglas de ANATEL, formato estándar de correo electrónico `[A-Za-z0-9._%+-]+@domain`, clave PIX EVP en contexto PIX y tokens JWT/Bearer) escapa del borde. Los formatos fuera de este alcance —como cuerpos de log estructurados con valor tipo mapa (ya que `replace_pattern(body, ...)` en `transform/pii_logs` opera únicamente sobre `body` de tipo string y atributos string), *quoted local parts* de correos electrónicos, números de teléfono sin código de área o nombres propios en texto libre— no se enmascaran antes de exportar a Loki y pueden atravesar la guarda.

## Consecuencias

### Positivas

- Los datos sensibles se redactan (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `[REDACTED_PIX_EMAIL]`, `[REDACTED_PHONE]`, `[REDACTED_PIX_EVP]`, `[REDACTED_JWT]`, `Bearer [REDACTED_TOKEN]`) antes de su persistencia en disco en Loki.
- Ninguna aplicación monitorizada necesita implementar bibliotecas propietarias de sanitización para beneficiarse de la protección.

### Compromisos

- Las expresiones regulares OTTL en el Collector operan mediante coincidencia sintáctica y no ejecutan validación de dígito de control Módulo-11 (esa validación refinada se ejecuta en `PiiPromptGuard`).
- El procesador `transform` añade una leve sobrecarga de CPU/RAM en el Collector, mitigada con `GOMEMLIMIT=200MiB` y `memory_limiter`.

## Alternativas descartadas

- **Sanitizar únicamente en el código de la aplicación objetivo:** vulneraría el diseño agnóstico de la plataforma y exigiría modificar cada microservicio monitorizado.
- **Sanitizar únicamente en `orchestrator`:** dejaría PII sin enmascarar persistidos en Loki.

## Referencias de código

- `infra/otel-collector-config.yaml`
- `infra/otel-collector-config.prod.yaml`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `scripts/smoke-phase1.sh`
