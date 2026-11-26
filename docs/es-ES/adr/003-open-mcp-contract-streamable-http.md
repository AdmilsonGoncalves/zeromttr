# ADR-003: Contrato abierto mediante Model Context Protocol (MCP) sobre Streamable HTTP

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

Las herramientas AIOps propietarias suelen encerrar sus integraciones de observabilidad y remediación tras código interno inaccesible para otros clientes. Para la categoría **Logística y Automatización**, la interoperabilidad entre sistemas críticos y agentes externos es un factor diferenciador clave.

## Decisión

Exponer todas las capacidades de observabilidad, inspección de código y acción de ZeroMTTR a través de un servidor compatible con **Model Context Protocol (MCP)** sobre **Streamable HTTP** (`POST /mcp` autenticado mediante `Authorization: Bearer <MCP_AUTH_TOKEN>`), proporcionando **8 herramientas estandarizadas**:

1. `execute_promql_range`
2. `search_traces_by_traceql`
3. `analyze_otel_trace`
4. `query_loki_logs`
5. `inspect_git_deploy_diff`
6. `create_remediation_pr`
7. `send_post_mortem_resend`
8. `annotate_grafana_incident`

Incluir el manifiesto `.mcp.json` en la raíz del repositorio como configuración base para clientes MCP compatibles (MCP Inspector, Claude Code, Claude Desktop). Para Cursor, la configuración del proyecto debe ubicarse en `.cursor/mcp.json` usando `${env:MCP_AUTH_TOKEN}` con la variable exportada en el entorno del cliente.

## Consecuencias

### Positivas

- El propio `apps/orchestrator` y cualquier cliente MCP externo consumen exactamente el mismo contrato validado por esquemas Zod (`@zeromttr/contracts`).
- Facilita la auditoría independiente de las herramientas sin necesidad de disparar todo el flujo completo de incidentes.

### Compromisos

- Requiere gestión de autenticación Bearer y validación estricta de payloads en el endpoint HTTP `/mcp`.

## Alternativas descartadas

- **Transporte `stdio` exclusivo:** inviable para la comunicación entre contenedores aislados en Docker Compose y en producción en VPS.
- **API REST propietaria:** perdería la compatibilidad nativa con el ecosistema de agentes MCP.

## Referencias de código

- `.mcp.json`
- `apps/mcp-server/src/transport/mcp-server.ts`
- `apps/mcp-server/src/transport/tool-registry.ts`
- `libs/contracts/src/tools/`
