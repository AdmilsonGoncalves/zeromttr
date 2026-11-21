# ADR-005: Truncamento Defensivo por Política e Telemetria FinOps no Servidor MCP

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

Respostas brutas de Prometheus, Tempo, Loki e GitHub Diff podem atingir centenas de kilobytes em incidentes reais. Enviar payloads brutos diretamente ao LLM eleva latência, aumenta custos de tokens e degrada a qualidade da janela de contexto.

## Decisão

Implementar, na camada de domínio do `apps/mcp-server`, sumarização e **truncamento defensivo por política** antes de retornar resultados ao orquestrador:

- Séries temporais PromQL são sumarizadas em estatísticas essenciais (`summarize-series.ts`).
- Traces OTel são filtrados para o caminho crítico e spans em erro (`span-analysis.ts`).
- Logs Loki e diffs Git respeitam tetos explícitos de linhas e **caracteres** (`maxLines` e `maxChars` em `truncate.ts`; são limites de contagem de caracteres, e não tetos diretos de bytes UTF-8).
- As ferramentas de maior volume textual (`execute_promql_range`, `query_loki_logs` e `inspect_git_deploy_diff`, excluindo `analyze_otel_trace` e `search_traces_by_traceql`) calculam e anexam telemetria FinOps (`finops.ts`): `rawBytesFetched`, `compactedBytesSentToLlm`, percentual de redução e estimativa conservadora de tokens economizados (`Math.round(bytesSaved / 4)`).

## Consequências

### Positivas

- Reduz drasticamente o volume enviado ao LLM (acima de 65%–90% conforme o volume de sinais coletados).
- Mantém o dashboard transparente quanto à economia de payload e evita estouro de janela de contexto.

### Trade-offs

- A métrica de tokens economizados é uma **estimativa proporcional ao tamanho do payload** (`bytes / 4`), não uma contagem exata do tokenizador proprietário do modelo.
- Evidências além do limite de truncamento são descartadas: diffs incluem o marcador explícito `... [TRUNCATED_DIFF]`, enquanto `truncateLines` descarta linhas excedentes acima de `maxLines` sem adicionar marcador de truncamento ao array retornado.

## Alternativas Descartadas

- **Enviar dumps brutos de telemetria ao LLM:** alto custo, latência imprevisível e risco de exceder limites de contexto.
- **Integrar tokenizador específico de um único provedor:** criaria dependência desnecessária e reduziria a portabilidade do servidor MCP.

## Referências no Código

- `apps/mcp-server/src/domain/finops.ts`
- `apps/mcp-server/src/domain/truncate.ts`
- `apps/mcp-server/src/domain/summarize-series.ts`
- `apps/mcp-server/src/domain/span-analysis.ts`
