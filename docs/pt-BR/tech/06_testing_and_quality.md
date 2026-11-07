# TECH 06 — Testes, Segurança e Qualidade (Transversal)

**Aplicável a:** todas as fases · **Referência:** mestre §6 e §10

## 1. Ferramentas
Vitest (unitário, segurança e integração), Supertest (HTTP), `nock` (contract tests de adapters HTTP), `@vitest/coverage-v8`, ESLint, Prettier, `tsc --noEmit`.

## 2. Estrutura de Testes
```text
apps/<pacote>/test/
  unit/          domínio, FSM, PiiPromptGuard, EvidenceCoverage e casos de uso (ports falsos)
  contract/      adapters HTTP com fixtures reais em test/fixtures/
  integration/   transporte HTTP/MCP, segregação de tokens, webhook, FSM + repositório
```

## 3. Regras de TDD para Agentes
1. Escrever o teste que falha (Red) antes do código de produção (Green) e refatorar (Refactor).
2. Nomear testes descrevendo o comportamento: `should_never_expose_hmac_decision_signatures_in_sse_or_incident_detail`.
3. Usar fakes explícitos (`FakeMetricsPort`, `SpyReasoningPort`) para testar casos de uso; usar `nock` apenas nos contract tests dos adapters HTTP.
4. **Proibido** chamar APIs externas reais (Gemini, GitHub, Resend) em testes automatizados.

## 4. Casos de Teste Obrigatórios (Checklist Verificável)
- [ ] **Truncamento e FinOps:** 500 chars/linha, 100 linhas, 1500 chars/diff do GitHub, 5 séries PromQL, e cálculo exato de `raw_bytes_fetched` vs. `compacted_bytes_sent_to_llm`.
- [ ] **Mascaramento OTTL na Borda + `PiiPromptGuard` Pré-LLM:**
  - Teste do Collector (`transform/pii_logs`) confirmando que CPF (`123.456.789-00`), CNPJ (`12.345.678/0001-99`), chave PIX (`motorista@translog.com.br`) e `Bearer eyJ...` no `log.body` saem mascarados.
  - Teste com `SpyReasoningPort` capturando o prompt exato enviado pelo `DispatchRemediation` e verificando `expect(capturedPrompt).not.toMatch(CPF_REGEX)` / `CNPJ_REGEX` / `BEARER_REGEX`.
- [ ] **Segregação de Tokens e Isolamento do HMAC:**
  - `POST /webhook/grafana-alert` com `DASHBOARD_API_TOKEN` → `401 Unauthorized`.
  - `GET /api/incidents/:id` e payload SSE `incident.notified` → `expect(JSON.stringify(payload)).not.toContain(approveSig)`.
  - `POST /api/incidents/:id/decision` com assinatura válida, adulterada e expirada.
- [ ] **Evidence Coverage Dinâmico:**
  - 4/4 sinais presentes → `95%` (`signalsCollected: 4, signalsTotal: 4`).
  - 3/4 sinais presentes (ex.: sem diff ou sem exemplar) → `75%` (`signalsCollected: 3, signalsTotal: 4`).
- [ ] **FSM e Deduplicação:** todas as transições válidas/inválidas e deduplicação de alertas abertos pelo mesmo `fingerprint`.
- [ ] **Escape de HTML no E-mail:** tentativa de injeção `<script>alert(1)</script>` no resumo do RCA ou nome do serviço é escapada em `renderPostMortem`.

## 5. Métricas de Qualidade no GitHub Actions CI/CD
| Verificação | Critério | Workflow |
| :--- | :--- | :--- |
| Cobertura `domain/` + `application/` | ≥ 80 % linhas e branches (bloqueante) | `ci.yml` |
| ESLint (incluindo fronteira hexagonal) + Prettier | 0 erros (bloqueante) | `ci.yml` |
| `tsc --noEmit` | 0 erros (bloqueante) | `ci.yml` |
| Segredos vazados (`gitleaks`) | 0 ocorrências (bloqueante) | `ci.yml` |
| Auditoria de dependências (`pnpm audit --prod --audit-level=critical`) | 0 vulnerabilidades `critical` (bloqueante) | `ci.yml` |
| Suíte de regressão nos PRs autônomos (`hotfix/zeromttr-*`) | 100 % verde + comentário no PR | `hotfix-verify.yml` (no repo-alvo) |
| Build & Push de imagens (`ghcr.io`) | Sucesso nos 4 serviços | `cd-release.yml` |

## 6. Definition of Done (Por Pull Request)
- [ ] Testes escritos primeiro e passando
- [ ] `pnpm run check:workspace` 100 % verde
- [ ] Sem segredos, sem PII e sem referências a artefatos externos não versionados
- [ ] Critérios de aceite do documento `tech/NN` correspondente cumpridos
