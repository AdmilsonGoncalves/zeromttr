# ADR-008: Concentração das Ferramentas e Adapters Externos no Servidor MCP

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

Se tanto o `apps/orchestrator` quanto o `apps/mcp-server` mantivessem clientes HTTP próprios para Prometheus, Tempo, Loki, GitHub, Resend e Grafana Annotations, haveria duplicação de lógica de autenticação, truncamento, tratamento de erros e regras FinOps.

## Decisão

Estabelecer que **todos os adapters HTTP para sistemas externos de observabilidade, código e notificação vivem exclusivamente em `apps/mcp-server/src/adapters/`**, expostos pelas 8 ferramentas MCP. O `apps/orchestrator` interage com esses sistemas unicamente através do port **`ToolsPort`**, implementado por `McpToolsClientAdapter` (`apps/orchestrator/src/adapters/mcp.client.ts`).

As únicas comunicações HTTP diretas do `orchestrator` fora do MCP são o LLM (`ReasoningPort`) e a verificação/controle de demonstração do serviço alvo (`TargetStatusPort` / `DemoControlPort`).

## Consequências

### Positivas

- Ponto único de governança para credenciais (`GITHUB_TOKEN`, `RESEND_API_KEY`, `GRAFANA_API_TOKEN`), truncamento e métricas FinOps.
- Qualquer cliente MCP externo herda automaticamente as mesmas proteções e comportamentos do orquestrador.

### Trade-offs

- Adiciona um salto HTTP local (`orchestrator` → `mcp-server`) na rede interna Docker, com latência desprezível (< 5 ms).

## Alternativas Descartadas

- **Orquestrador chamando APIs de observabilidade diretamente:** quebraria a paridade com o contrato MCP e duplicaria adapters.

## Referências no Código

- `apps/mcp-server/src/adapters/`
- `apps/orchestrator/src/ports/tools.port.ts`
- `apps/orchestrator/src/adapters/mcp.client.ts`
