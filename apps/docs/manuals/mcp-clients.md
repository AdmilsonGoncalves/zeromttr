---
id: mcp-clients
title: Integração com Clientes MCP
slug: /mcp-clients
---

# Integração com Clientes MCP

O ZeroMTTR expõe suas capacidades de observabilidade, código e notificação através do padrão aberto **Model Context Protocol (MCP)** sobre Streamable HTTP.

Isso significa que você pode usar o **Claude Code**, **Claude Desktop**, **Cursor** ou o **MCP Inspector** para investigar incidentes diretamente usando as mesmas ferramentas do orquestrador.

## Configuração rápida (`.mcp.json`)

Na raiz do repositório já existe um arquivo `.mcp.json` pronto para uso com clientes compatíveis:

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

Como o `.env` não é carregado automaticamente no ambiente do cliente MCP, exporte `MCP_AUTH_TOKEN` no shell antes de iniciar o **Claude Code** (ou outro cliente compatível) para que `${MCP_AUTH_TOKEN}` seja expandido no cabeçalho:

```bash
export MCP_AUTH_TOKEN="$(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2-)"
claude
```

:::info Usuários do Cursor
O Cursor lê configurações de projeto em `.cursor/mcp.json` e usa a sintaxe `${env:MCP_AUTH_TOKEN}` para ler variáveis de ambiente. Exporte `MCP_AUTH_TOKEN` no shell antes de abrir o cliente.
:::

## Testando com o MCP Inspector

Com a stack local rodando:

```bash
export MCP_AUTH_TOKEN="$(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2-)"
npx @modelcontextprotocol/inspector
```

No Inspector, conecte via **Streamable HTTP** em `http://localhost:8000/mcp` com o cabeçalho `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Ferramentas disponíveis (8 tools)

| Categoria           | Ferramenta                  | O que faz                                                                                      |
| :------------------ | :-------------------------- | :--------------------------------------------------------------------------------------------- |
| **Métricas**        | `execute_promql_range`      | Executa consultas PromQL no Prometheus com sumarização determinística e extração de exemplars. |
| **Traces**          | `analyze_otel_trace`        | Analisa a árvore de spans de um `trace_id` no Tempo e isola o span crítico com erro.           |
| **Traces**          | `search_traces_by_traceql`  | Busca traces recentes com erro no Tempo filtrando por serviço.                                 |
| **Logs**            | `query_loki_logs`           | Consulta logs já mascarados na borda no Loki com truncamento controlado (FinOps).              |
| **Código**          | `inspect_git_deploy_diff`   | Inspeciona o diff real no GitHub entre a versão saudável e a degradada.                        |
| **Remediação**      | `create_remediation_pr`     | Cria uma branch `hotfix/*` e abre um Pull Request contra a branch de release.                  |
| **Notificação**     | `send_post_mortem_resend`   | Envia o relatório post-mortem por e-mail com links de decisão assinados.                       |
| **Observabilidade** | `annotate_grafana_incident` | Publica anotações do ciclo de vida do incidente diretamente nos gráficos do Grafana.           |
