# 🤖 Instruções para Agentes de Codificação — ZeroMTTR

Este documento estabelece as regras obrigatórias e inegociáveis para qualquer agente de codificação atuando no repositório **ZeroMTTR**. Leia e siga integralmente antes de realizar qualquer alteração.

---

## 1. Contexto e Ordem de Leitura

- **O que é o ZeroMTTR:** Plataforma autônoma de AIOps e remediação de incidentes inscrita na trilha **Logística & Automação** (automação de fluxos de trabalho operacionais e integrações entre sistemas críticos). Arquitetura agnóstica de domínio (_Clean Architecture_). Monorepo único: `https://github.com/AdmilsonGoncalves/zeromttr`.
- **Ordem obrigatória de leitura:**
  1. `docs/pt-BR/00_architecture_master.md` (visão geral, ADRs e KPIs)
  2. `docs/pt-BR/01_system_diagrams.md` (casos de uso, sequência e diagramas)
  3. `docs/pt-BR/tech/NN_*.md` da tarefa atribuída
- **Regra de execução:** Implementar **somente** o documento `tech/NN` atribuído, do zero e em TDD, parando quando todos os critérios de aceite estiverem verdes.

---

## 2. Comandos Essenciais

```bash
# Instalação com lockfile congelado
pnpm install --frozen-lockfile

# Checagem completa de qualidade do workspace (Prettier + Nx lint, typecheck, test, build)
pnpm run check:workspace

# Execução direcionada por pacote
pnpm nx test <app>
pnpm nx run-many -t typecheck

# Inicialização da infraestrutura local de observabilidade
docker compose up -d
```

---

## 3. Arquitetura e Fronteiras

- **`apps/orchestrator` e `apps/mcp-server`:** Arquitetura Hexagonal (_Ports & Adapters_).
  - Fluxo: `domain` → `application` → `ports` → `adapters`, com composition root em `main.ts`.
  - O `domain` e `application` **nunca** importam adapters, transport, http ou bibliotecas externas de infraestrutura (`express`, `axios`, `@modelcontextprotocol/sdk`). Isso é imposto via ESLint (`no-restricted-imports`).
- **`apps/target-app-demo`:** MVC em camadas (`routes` → `controllers` → `services` → `repositories`).
- **`apps/dashboard`:** Single-Page Application Angular standalone com Signals (`WarRoomComponent` + `DecisionComponent`).
- **Isolamento de domínio:** O núcleo do ZeroMTTR permanece agnóstico; nenhuma regra de negócio específica de `api-pagamentos-core` pode vazar para o orquestrador ou servidor MCP.

---

## 4. Estratégia de Testes (Testing Trophy)

- **Prioridade:** Testes de integração e E2E primeiro (`test/integration/`). Testes unitários (`test/unit/`) são reservados estritamente para funções puras de apoio (Módulo-11, regexes ANATEL/BACEN, FinOps, renderizador de templates).
- **Helpers:** Criar helpers reutilizáveis em `test/helpers/` antes das suítes de teste, sem duplicar chamadas HTTP Supertest ou montagens de payload.
- **TDD:** Escrever os _Happy Paths_ e _Unhappy Paths_ antes do código de produção (Red → Green → Refactor), utilizando tabelas parametrizadas (`it.each`) para regexes e validações.
- **Nomenclatura:** Nomear os casos de teste pelo comportamento esperado (`should_...`).
- **Proibição:** É estritamente proibido chamar APIs externas reais (Gemini, GitHub, Resend) na suíte automatizada. Utilizar interceptadores HTTP (`nock`).

---

## 5. Regras de Segurança Inegociáveis

- **Segredos:** Nunca commitar credenciais reais, arquivos `.env` ou diretórios auxiliares (`docs/apoio/`).
- **Decisões HMAC:** Nunca expor `sig`, `approveSig` ou `rejectSig` em respostas REST, streams SSE ou logs. A assinatura trafega no `#fragment` da URL enviada por e-mail via Resend e é transmitida exclusivamente no corpo da requisição `POST /api/incidents/:id/decision` para validação.
- **Segregação de Tokens:** Manter estritamente segregados os três tokens:
  - `MCP_AUTH_TOKEN`: Autenticação do servidor MCP
  - `GRAFANA_WEBHOOK_TOKEN`: Autenticação do webhook de alerta do Grafana
  - `DASHBOARD_API_TOKEN`: Autenticação injetada pelo proxy Nginx para rotas `/api/*`
- **Privacidade de Dados:** Nunca usar dados pessoais reais (CPF, CNPJ, telefone, e-mail, chaves PIX) em logs, fixtures, prompts ou documentação; utilizar exclusivamente geradores sintéticos válidos.
- **Guarda de Prompt:** O `PiiPromptGuard` opera sempre em modo _fail-closed_. Se qualquer padrão residual for detectado, o envio ao LLM é abortado imediatamente.

---

## 6. Regras de Git

- **Conventional Commits:** Seguir padrão Conventional Commits verificado via Commitlint.
- **Sem Commits Involuntários:** **Nunca executar `git commit` ou `git push` sem ordem explícita do usuário.**
- **Branches e Pull Requests:** Nunca fazer push direto na branch `master`. Utilizar branch de feature e Pull Request.
- **Integridade do Histórico:** Nunca utilizar `git push --force`.

---

## 7. Regras do Cenário de Demonstração

- **Criação de Tags e Branches de Demo:** As tags `v2.14.7` e `v2.14.8` e a branch `release/target-v2.14.8` só são criadas ao final da Fase 3, após `hotfix-verify.yml`, `pnpm-lock.yaml` e testes do `target-app-demo` existirem na `master`.
- **Disparo de Deploy na VPS:** Tags `v2.14.*` jamais disparam deploy; apenas tags de versão da plataforma `v1.*.*` ou `workflow_dispatch` acionam o job `deploy-vps`.
- **Saúde da Master:** A branch `master` permanece sempre verde e saudável (`v2.14.7`). A regressão vive exclusivamente em `release/target-v2.14.8`.

---

## 8. Definition of Done (DoD)

Antes de declarar uma tarefa ou fase concluída:

- [ ] Helpers de teste criados em `test/helpers/` sem duplicação de código HTTP.
- [ ] Testes de integração (_Happy_ e _Unhappy Paths_) e testes de apoio passando.
- [ ] `pnpm run check:workspace` 100% verde (Prettier, ESLint, typecheck, tests, build).
- [ ] Zero segredos, zero dados reais de PII e sem dependências órfãs.
- [ ] Todos os critérios de aceite do documento técnico `tech/NN` cumpridos.
