# ADR-002: Arquitectura Hexagonal (Puertos y Adaptadores) en Orchestrator y MCP Server

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

El núcleo de ZeroMTTR debe permanecer 100 % agnóstico tanto respecto al dominio del servicio monitorizado como respecto a las tecnologías de infraestructura (HTTP, Express, MCP SDK, proveedores de LLM o APIs de observabilidad), garantizando una alta capacidad de prueba sin llamadas externas reales.

## Decisión

Adoptar la **Arquitectura Hexagonal (Puertos y Adaptadores)** en `apps/orchestrator` y `apps/mcp-server`, estructurando el flujo de dependencias unidireccional:

```text
domain ──> application ──> ports <── adapters / http / transport
                                        └── main.ts (composition root)
```

Las fronteras se imponen automáticamente mediante ESLint (`no-restricted-imports`) y se verifican en pruebas automatizadas:

- `domain` y `application` **nunca** importan `adapters`, `http`, `transport`, `@zeromttr/utils/http` ni bibliotecas de infraestructura (`express`, `axios`, `@modelcontextprotocol/sdk`).
- Toda la inyección de dependencias ocurre exclusivamente en el *composition root* (`src/main.ts`).

## Consecuencias

### Positivas

- Las reglas de FSM, cobertura de evidencias, guarda de PII, FinOps y sumarización se prueban con rapidez y determinismo.
- Cambiar de proveedor (p. ej., Gemini por otro LLM, persistencia en archivos por PostgreSQL) requiere únicamente un nuevo adaptador que implemente el puerto correspondiente.

### Compromisos

- Un mayor número de interfaces explícitas (`ports/*.port.ts`) en comparación con una arquitectura acoplada directamente a los SDK.

## Alternativas descartadas

- **Acoplamiento directo a Express/SDK en la capa de servicios:** dificultaría las pruebas deterministas y filtraría detalles de transporte al dominio.

## Referencias de código

- `eslint.config.mjs`
- `apps/orchestrator/src/main.ts`, `apps/orchestrator/src/ports/`
- `apps/mcp-server/src/main.ts`, `apps/mcp-server/src/ports/`
- `apps/orchestrator/test/unit/hexagonal-boundary.spec.ts`
