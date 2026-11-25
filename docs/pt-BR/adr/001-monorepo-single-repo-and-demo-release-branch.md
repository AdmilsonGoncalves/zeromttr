# ADR-001: Monorepo Único pnpm + Nx com Branch de Regressão Isolada para Demonstração

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

O ZeroMTTR combina quatro aplicações (`orchestrator`, `mcp-server`, `dashboard` e `target-app-demo`), duas bibliotecas compartilhadas (`libs/contracts` e `libs/utils`) e a pilha local de observabilidade (`infra/`). Além disso, a demonstração ao vivo exige um cenário reproduzível de regressão em `target-app-demo` para gerar Pull Requests reais de hotfix no GitHub sem comprometer a integridade da branch principal.

## Decisão

1. Adotar um **monorepo único** gerenciado com **pnpm workspaces** e **Nx**, centralizando contratos compartilhados (`@zeromttr/contracts`), utilitários puros (`@zeromttr/utils`), lint, typecheck, testes e build em um único pipeline (`pnpm run check:workspace`).
2. Manter a branch **`master` sempre verde e saudável** (marcada com a tag **`v2.14.7`**).
3. Isolar a regressão controlada de esgotamento de pool (`KnexTimeoutError`) na branch **`release/target-v2.14.8`** (marcada com a tag **`v2.14.8`**), usada como base para o diff real `v2.14.7...v2.14.8` e alvo dos Pull Requests autônomos de hotfix validados por `.github/workflows/hotfix-verify.yml`.

## Consequências

### Positivas

- Contratos tipados (`@zeromttr/contracts`) evitam deriva entre `orchestrator`, `mcp-server` e `dashboard`.
- Qualquer avaliador executa o ecossistema completo com um único `git clone` e `docker compose up -d`.
- Pull Requests de demonstração nunca poluem nem quebram a branch `master`.

### Trade-offs

- Exige disciplina de proteção de branch (`master`) e de tags (`v2.14.*`) no GitHub.
- O workflow de deploy na VPS deve restringir triggers apenas a tags `v1.*.*` ou `workflow_dispatch`, ignorando tags `v2.14.*`.

## Alternativas Descartadas

- **Múltiplos repositórios (polyrepo):** aumentaria o atrito de versionamento de contratos e complicaria a reprodução local em ambiente limpo.
- **Injetar bug diretamente na `master`:** quebraria o CI da branch principal e violaria boas práticas de engenharia.

## Referências no Código

- `nx.json`, `pnpm-workspace.yaml`, `package.json`
- `.github/workflows/ci.yml`, `.github/workflows/hotfix-verify.yml`
- `apps/target-app-demo/src/repositories/payment.repository.ts`
