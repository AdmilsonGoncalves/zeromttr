# ADR-003: Contrato Aberto via Model Context Protocol (MCP) sobre Streamable HTTP

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

Ferramentas proprietárias de AIOps costumam encerrar suas integrações de observabilidade e remediação em código interno inacessível a outros clientes. Para a trilha de **Logística & Automação**, a interoperabilidade entre sistemas críticos e agentes externos é um diferencial central.

## Decisão

Expor todas as capacidades de observabilidade, inspeção de código e ação do ZeroMTTR por meio de um servidor compatível com **Model Context Protocol (MCP)** sobre **Streamable HTTP** (`POST /mcp` autenticado por `Authorization: Bearer <MCP_AUTH_TOKEN>`), disponibilizando **8 ferramentas padronizadas**:

1. `execute_promql_range`
2. `search_traces_by_traceql`
3. `analyze_otel_trace`
4. `query_loki_logs`
5. `inspect_git_deploy_diff`
6. `create_remediation_pr`
7. `send_post_mortem_resend`
8. `annotate_grafana_incident`

Incluir o manifesto `.mcp.json` na raiz do repositório como configuração base para clientes MCP compatíveis (MCP Inspector, Claude Code, Claude Desktop). Para o Cursor, a configuração de projeto deve ser colocada em `.cursor/mcp.json` utilizando `${env:MCP_AUTH_TOKEN}` com a variável exportada no ambiente do cliente.

## Consequências

### Positivas

- O próprio `apps/orchestrator` e qualquer cliente MCP externo consomem exatamente o mesmo contrato validado por schemas Zod (`@zeromttr/contracts`).
- Facilita auditoria independente das ferramentas sem precisar disparar o fluxo completo de incidentes.

### Trade-offs

- Exige gerenciamento de autenticação Bearer e validação estrita de payload no endpoint HTTP `/mcp`.

## Alternativas Descartadas

- **Transporte `stdio` exclusivo:** inviável para comunicação entre contêineres isolados em Docker Compose e produção VPS.
- **API REST proprietária:** perderia compatibilidade nativa com o ecossistema de agentes MCP.

## Referências no Código

- `.mcp.json`
- `apps/mcp-server/src/transport/mcp-server.ts`
- `apps/mcp-server/src/transport/tool-registry.ts`
- `libs/contracts/src/tools/`
