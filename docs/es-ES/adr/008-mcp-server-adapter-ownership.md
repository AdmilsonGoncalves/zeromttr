# ADR-008: Consolidación de herramientas y adaptadores externos en el servidor MCP

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

Si tanto `apps/orchestrator` como `apps/mcp-server` mantuvieran sus propios clientes HTTP para Prometheus, Tempo, Loki, GitHub, Resend y Grafana Annotations, se duplicarían la lógica de autenticación, el truncado, el manejo de errores y las reglas FinOps.

## Decisión

Establecer que **todos los adaptadores HTTP para sistemas externos de observabilidad, código y notificaciones residen exclusivamente en `apps/mcp-server/src/adapters/`**, expuestos a través de las 8 herramientas MCP. `apps/orchestrator` interactúa con estos sistemas únicamente a través del puerto **`ToolsPort`**, implementado por `McpToolsClientAdapter` (`apps/orchestrator/src/adapters/mcp.client.ts`).

Las únicas comunicaciones HTTP directas desde `orchestrator` fuera de MCP son el LLM (`ReasoningPort`) y la verificación/control de demostración del servicio objetivo (`TargetStatusPort` / `DemoControlPort`).

## Consecuencias

### Positivas

- Punto único de gobernanza para credenciales (`GITHUB_TOKEN`, `RESEND_API_KEY`, `GRAFANA_API_TOKEN`), truncado y métricas FinOps.
- Cualquier cliente MCP externo hereda automáticamente las mismas protecciones y comportamientos que el orquestador.

### Compromisos

- Añade un salto HTTP local (`orchestrator` → `mcp-server`) sobre la red interna de Docker, con una latencia despreciable (< 5 ms).

## Alternativas descartadas

- **Que el orquestador llame directamente a las APIs de observabilidad:** rompería la paridad con el contrato MCP y duplicaría los adaptadores.

## Referencias de código

- `apps/mcp-server/src/adapters/`
- `apps/orchestrator/src/ports/tools.port.ts`
- `apps/orchestrator/src/adapters/mcp.client.ts`
