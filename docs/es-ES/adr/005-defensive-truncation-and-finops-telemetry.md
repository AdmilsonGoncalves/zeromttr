# ADR-005: Truncado defensivo basado en políticas y telemetría FinOps en el servidor MCP

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

Las respuestas sin procesar de Prometheus, Tempo, Loki y GitHub Diff pueden alcanzar cientos de kilobytes en incidentes reales. Enviar payloads sin procesar directamente al LLM incrementa la latencia, eleva el coste de tokens y degrada la calidad de la ventana de contexto.

## Decisión

Implementar la sumarización y el **truncado defensivo basado en políticas** en la capa de dominio de `apps/mcp-server` antes de devolver los resultados al orquestador:

- Las series temporales de PromQL se resumen en estadísticas esenciales (`summarize-series.ts`).
- Las trazas OTel se filtran hacia la ruta crítica y los spans con error (`span-analysis.ts`).
- Los registros de Loki y los diffs de Git aplican límites explícitos de líneas y **caracteres** (`maxLines` y `maxChars` en `truncate.ts`; son límites por número de caracteres, no límites directos de bytes UTF-8).
- Las herramientas con alto volumen de texto (`execute_promql_range`, `query_loki_logs` e `inspect_git_deploy_diff`, excluyendo `analyze_otel_trace` y `search_traces_by_traceql`) calculan y adjuntan telemetría FinOps (`finops.ts`): `rawBytesFetched`, `compactedBytesSentToLlm`, porcentaje de reducción y una estimación conservadora de tokens ahorrados (`Math.round(bytesSaved / 4)`).

## Consecuencias

### Positivas

- Reduce drásticamente el volumen enviado al LLM (más de un 65 %–90 % según el volumen de señales recopilado).
- Mantiene la transparencia en el panel sobre el ahorro de payload y evita el desbordamiento de la ventana de contexto.

### Compromisos

- La métrica de tokens ahorrados es una **estimación proporcional al tamaño del payload** (`bytes / 4`), no un recuento exacto del tokenizador propietario del modelo.
- La evidencia que supera el límite de truncado se descarta: los diffs incluyen el marcador explícito `... [TRUNCATED_DIFF]`, mientras que `truncateLines` descarta las líneas excedentes por encima de `maxLines` sin añadir un marcador de truncado al array devuelto.

## Alternativas descartadas

- **Enviar volcados de telemetría sin procesar al LLM:** coste elevado, latencia impredecible y riesgo de exceder los límites de contexto.
- **Integrar el tokenizador específico de un único proveedor:** crearía una dependencia innecesaria y reduciría la portabilidad del servidor MCP.

## Referencias de código

- `apps/mcp-server/src/domain/finops.ts`
- `apps/mcp-server/src/domain/truncate.ts`
- `apps/mcp-server/src/domain/summarize-series.ts`
- `apps/mcp-server/src/domain/span-analysis.ts`
