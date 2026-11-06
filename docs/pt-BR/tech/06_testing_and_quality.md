# TECH 06 — Testes e Qualidade (transversal)

**Aplicável a:** todas as fases · **Referência:** mestre §6 e §10

## 1. Ferramentas
Vitest (unit/integração), Supertest (HTTP), `nock` ou MSW (mocks HTTP), `@vitest/coverage-v8`, ESLint, Prettier, `tsc --noEmit`. Testcontainers opcional para Postgres.

## 2. Estrutura
```text
apps/<pacote>/test/
  unit/          domínio e casos de uso (ports falsos)
  contract/      adapters HTTP com fixtures em test/fixtures/
  integration/   transporte HTTP/MCP, webhook, FSM + repositório
  e2e/           (raiz) cenário completo contra o Compose
```

## 3. Regras de TDD para agentes
1. Commit separado "test: ..." (Red) antes do "feat: ..." (Green) sempre que possível.
2. Não escrever código de produção sem teste que falhe primeiro.
3. Nomear testes como comportamento: `should_truncate_log_line_above_500_chars`.
4. Um *assert* conceitual por teste; sem lógica condicional em testes.
5. Fakes explícitos (`FakeMetricsPort`) em vez de mocks frouxos; mocks HTTP apenas nos adapters.
6. **Proibido** chamar APIs externas reais em testes automatizados.

## 4. Casos obrigatórios (checklist)
- [ ] Truncamento: 500 chars/linha, 100 linhas, 1500 chars/diff do GitHub, 5 séries PromQL.
- [ ] Sumarização PromQL com série vazia e divisor zero.
- [ ] Análise de trace: span com erro, `false`/`0` em atributos, trace inexistente.
- [ ] FSM: todas as transições válidas e inválidas.
- [ ] Deduplicação de alertas por fingerprint.
- [ ] Escape de HTML no e-mail (payload `<script>`).
- [ ] HMAC de decisão: válida, adulterada, expirada.
- [ ] Redaction: CPF, cartão, JWT, Bearer, senha (teste de integração com o Collector).
- [ ] Auth: 401 sem token em MCP, webhook e rotas protegidas.
- [ ] Timeouts, idempotência e retries dos adapters (GitHub API e Resend).

## 5. Métricas de qualidade (bloqueantes no GitHub Actions CI/CD)
| Métrica | Limite | Workflow |
| :--- | :--- | :--- |
| Cobertura `domain/` + `application/` | ≥ 80 % linhas e ramos | `ci.yml` |
| ESLint + Prettier | 0 erros | `ci.yml` |
| `tsc --noEmit` | 0 erros | `ci.yml` e `hotfix-verify.yml` |
| Segredos vazados (`gitleaks`) | 0 ocorrências | `ci.yml` |
| Suíte de regressão nos PRs autônomos (`hotfix/zeromttr-*`) | 100 % verde + comentário automático no PR | `hotfix-verify.yml` |
| Build & Push de imagens multi-stage (`ghcr.io`) | Sucesso nos 4 serviços | `cd-release.yml` |
| Vulnerabilidades `high/critical` em prod | 0 (alerta, revisão manual) | `ci.yml` |

## 6. Convenções de código e Regras Automáticas de Lint
- `strict: true`; proibido `any` fora de fronteira (parse com `zod` e tipos inferidos).
- **Fronteira Hexagonal garantida por ESLint (`no-restricted-imports`):** `domain` e `application` nunca importam `adapters`, `transport`, `http`, `express`, `axios` ou `@modelcontextprotocol/sdk`.
- **Promises seguras:** `@typescript-eslint/no-floating-promises` e `@typescript-eslint/no-misused-promises` ativos para evitar *UnhandledPromiseRejection* em loops assíncronos, webhooks e SSE.
- **Gate único antes do push (`.husky/pre-push`):** `pnpm run check:workspace` (executa `lint --fix`, `typecheck`, `test` e `build` em todos os pacotes via Nx).
- Funções ≤ 30 linhas como guia; arquivos ≤ 300 linhas como guia.
- Comentários explicam *por quê*, não *o quê*.

## 7. Definition of Done (PR)
- [ ] Testes novos escritos antes e verdes
- [ ] `pnpm run check:workspace` 100 % verde
- [ ] Sem segredos/PII
- [ ] Docs/ADR atualizados se houve decisão arquitetural
- [ ] Critérios de aceite do doc `tech/NN` correspondente marcados
