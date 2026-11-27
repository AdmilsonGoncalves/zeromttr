---
id: mcp-clients
title: Integración con Clientes MCP
slug: /mcp-clients
sidebar_position: 7
---

# Integración con Clientes MCP

ZeroMTTR expone sus capacidades de observabilidad, análisis de código y notificación mediante el estándar abierto **Model Context Protocol (MCP)** sobre Streamable HTTP.

Puedes conectar **Claude Code**, **Claude Desktop**, **Cursor** o **MCP Inspector** directamente para investigar incidentes usando las mismas herramientas que el orquestador.

## Configuración rápida (`.mcp.json`)

La raíz del repositorio incluye un archivo `.mcp.json` listo para clientes compatibles:

```json
{
  "mcpServers": {
    "zeromttr-aiops": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

:::info Usuarios de Cursor
Cursor lee configuraciones MCP de proyecto en `.cursor/mcp.json` y usa `${env:MCP_AUTH_TOKEN}` para interpolar variables de entorno. Exporta `MCP_AUTH_TOKEN` en tu shell antes de iniciar el cliente.
:::

## Prueba con MCP Inspector

Con la pila local activa:

```bash
export MCP_AUTH_TOKEN="$(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2-)"
npx @modelcontextprotocol/inspector
```

En el Inspector, conéctate vía **Streamable HTTP** a `http://localhost:8000/mcp` con la cabecera `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Herramientas disponibles (8)

| Categoría          | Herramienta                 | Finalidad                                                                                        |
| :----------------- | :-------------------------- | :----------------------------------------------------------------------------------------------- |
| **Métricas**       | `execute_promql_range`      | Ejecuta consultas PromQL en Prometheus con sumarización determinista y extracción de ejemplares. |
| **Trazas**         | `analyze_otel_trace`        | Analiza el árbol de spans de un `trace_id` en Tempo y aísla el span crítico con error.           |
| **Trazas**         | `search_traces_by_traceql`  | Busca trazas recientes con error en Tempo filtrando por servicio.                                |
| **Logs**           | `query_loki_logs`           | Consulta logs enmascarados en el borde en Loki con truncamiento controlado (FinOps).             |
| **Código**         | `inspect_git_deploy_diff`   | Inspecciona el diff real en GitHub entre la versión saludable y la degradada.                    |
| **Remediación**    | `create_remediation_pr`     | Crea una rama `hotfix/*` y abre un Pull Request contra la rama de release.                       |
| **Notificación**   | `send_post_mortem_resend`   | Envía el correo post-mortem con enlaces de decisión firmados.                                    |
| **Observabilidad** | `annotate_grafana_incident` | Publica anotaciones del ciclo de vida del incidente directamente en Grafana.                     |
