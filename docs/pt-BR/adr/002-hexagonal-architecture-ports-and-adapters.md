# ADR-002: Arquitetura Hexagonal (Ports & Adapters) em Orchestrator e MCP Server

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

O núcleo do ZeroMTTR precisa permanecer 100% agnóstico tanto ao domínio do serviço monitorado quanto às tecnologias de infraestrutura (HTTP, Express, SDK MCP, provedores de LLM ou APIs de observabilidade), garantindo alta testabilidade sem chamadas externas reais.

## Decisão

Adotar **Arquitetura Hexagonal (Ports & Adapters)** em `apps/orchestrator` e `apps/mcp-server`, estruturando o fluxo unidirecional de dependências:

```text
domain ──> application ──> ports <── adapters / http / transport
                                        └── main.ts (composition root)
```

As fronteiras são impostas automaticamente por ESLint (`no-restricted-imports`) e verificadas em testes automatizados:

- `domain` e `application` **nunca** importam `adapters`, `http`, `transport`, `@zeromttr/utils/http` ou bibliotecas de infraestrutura (`express`, `axios`, `@modelcontextprotocol/sdk`).
- Toda injeção de dependência ocorre exclusivamente no *composition root* (`src/main.ts`).

## Consequências

### Positivas

- Regras de FSM, cobertura de evidências, guarda de PII, FinOps e sumarização são testadas com velocidade e determinismo.
- Trocar provedores (ex.: Gemini por outro LLM, persistência em arquivo por PostgreSQL) exige apenas um novo adapter implementando o port correspondente.

### Trade-offs

- Maior número de interfaces explícitas (`ports/*.port.ts`) em comparação com uma arquitetura acoplada diretamente a SDKs.

## Alternativas Descartadas

- **Acoplamento direto a Express/SDKs na camada de serviço:** dificultaria testes determinísticos e vazaria detalhes de transporte para o domínio.

## Referências no Código

- `eslint.config.mjs`
- `apps/orchestrator/src/main.ts`, `apps/orchestrator/src/ports/`
- `apps/mcp-server/src/main.ts`, `apps/mcp-server/src/ports/`
- `apps/orchestrator/test/unit/hexagonal-boundary.spec.ts`
