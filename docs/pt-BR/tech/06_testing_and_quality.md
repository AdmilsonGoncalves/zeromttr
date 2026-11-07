# TECH 06 — Estratégia de Testes (Integração & E2E First), Helpers e Qualidade (Transversal)

**Aplicável a:** todas as fases · **Referência:** mestre §6 e §10

## 1. Filosofia de Testes: *Testing Trophy* (Prioridade em Integração e E2E)
Como o **ZeroMTTR** é uma plataforma orientada a eventos e integração entre sistemas (Grafana Alerting → Orchestrator HTTP/SSE → MCP Server HTTP → OTel Collector/LGTM → GitHub/Resend/Gemini), o projeto adota o modelo **Testing Trophy**:
1. **Prioridade Principal — Testes de Integração e E2E (`test/integration/` e `scripts/smoke-*.sh`):**
   - Exercitam o fluxo real da aplicação a partir da borda HTTP (`Supertest`), passando pelo roteamento, autenticação, máquina de estados (FSM), `PiiPromptGuard`, comunicação MCP sobre HTTP e serialização SSE, interceptando apenas as APIs externas na fronteira HTTP de saída (`nock`).
   - Cobrem obrigatoriamente **tanto os *Happy Paths* quanto os *Unhappy Paths*** antes da implementação (TDD de integração), funcionando como documentação executável do sistema.
2. **Testes Unitários Apenas para Funções Puras de Apoio (`test/unit/`):**
   - Reservados **estritamente** para algoritmos puros sem I/O: cálculo de dígitos verificadores Módulo-11 (CPF/CNPJ), validadores de expressão regular (ANATEL / BACEN EVP / JWT), cálculo linear do `EvidenceCoverage`, truncamento/poda de bytes FinOps, transições puras da FSM e escape HTML (`renderPostMortem`).
   - Evita-se criar dezenas de testes unitários acoplados a mocks artificiais para fluxos que já são validados de forma muito mais fiel pelos testes de integração.

---

## 2. Estrutura de Pastas e Helpers Obrigatórios de Teste (`test/helpers/`)
Para evitar repetição de comandos HTTP (`supertest(app).post(...).set('Authorization', ...)`), montagem de payloads ou configuração repetitiva de `nock`, cada pacote **deve implementar funções helpers reutilizáveis em `test/helpers/` antes de escrever as suítes**:

```text
apps/<pacote>/test/
  helpers/
    http-test-client.ts     # Funções helpers que encapsulam chamadas Supertest e headers de auth
    external-apis.helper.ts # Builders reutilizáveis do nock para LGTM, GitHub, Gemini e Resend
    fixtures.helper.ts      # Fábricas de payloads (alertas Grafana, logs com/sem PII, diffs Git)
  integration/              # Prioridade principal: fluxos completos HTTP, MCP, SSE e PII (Happy & Unhappy)
  unit/                     # Apenas funções puras de apoio (Módulo-11, regexes ANATEL/BACEN, FinOps, FSM)
```

### Contrato Mínimo dos Helpers (`test/helpers/http-test-client.ts` & `external-apis.helper.ts`)
- **`postGrafanaAlert(app, overrides?, token = GRAFANA_WEBHOOK_TOKEN)`:** dispara `POST /webhook/grafana-alert` com cabeçalho `Bearer` e payload padrão válido (permitindo sobrescrever campos ou testar tokens inválidos em 1 linha).
- **`getIncident(app, incidentId, token = DASHBOARD_API_TOKEN)`:** executa `GET /api/incidents/:id` com autenticação do Dashboard.
- **`postEmailHmacDecision(app, incidentId, { action, sig, exp })`:** executa `POST /api/incidents/:id/decision` simulando o envio do fragmento `#` lido pela SPA.
- **`callMcpTool(app, toolName, args, token = MCP_AUTH_TOKEN)`:** encapsula o envelope JSON-RPC `tools/call` sobre `POST /mcp`.
- **`collectSseEventsUntil(app, predicateOrState, timeoutMs)`:** conecta em `GET /api/events` e coleta os eventos SSE emitidos até atingir o estado alvo (ex.: `NOTIFIED` ou `RESOLVED`).
- **`stubObservabilityAndGithub({ lokiLogBody, traceStatus, gitDiffPatch, geminiShouldFail })`:** configura em uma única chamada todos os interceptadores HTTP (`nock`) do Prometheus, Tempo, Loki, GitHub, Gemini e Resend, permitindo testar qualquer *Happy Path* ou *Unhappy Path* trocando apenas o parâmetro desejado.

---

## 3. Regras de Desenvolvimento Orientado a Testes (TDD de Integração + Apoio)
1. **Escrever os *Happy Paths* e *Unhappy Paths* primeiro (Red → Green → Refactor):** antes de implementar uma rota, tool MCP ou regra de proteção de PII, escrever os cenários de sucesso e de falha usando os helpers de `test/helpers/`.
2. **Testes parametrizados (`it.each` / `test.each`):** para regras de validação e regexes (CPF, CNPJ, ANATEL, EVP BACEN, JWT), utilizar tabelas parametrizadas contendo lado a lado as entradas válidas (*Happy*) e inválidas/adversariais (*Unhappy*), servindo como documentação viva.
3. **Proibido chamar APIs externas reais na suíte automatizada (`ci.yml`):** toda comunicação com Gemini, GitHub, Resend e LGTM nos testes de integração do Vitest passa pelos helpers de `external-apis.helper.ts` (`nock`). O teste real contra os contêineres Docker e APIs externas ocorre nos scripts de smoke/E2E (`scripts/smoke-integrations.sh`).

---

## 4. Matriz Obrigatória de *Happy Paths* vs. *Unhappy Paths* (Documentação Executável)

### 4.1 Integração e Apoio: Dupla Barreira de PII (5 Tipos de Chave PIX BACEN + ANATEL + JWT)
Testado **tanto no pipeline de integração** (injetando o log via `stubObservabilityAndGithub({ lokiLogBody })` e verificando o comportamento do Orquestrador + `PiiPromptGuard` + chamada ou bloqueio ao Gemini) **quanto na tabela parametrizada (`it.each`) da função de apoio**:

| Regra / Padrão | 🟢 Happy Path (Telemetria Limpa / Pós-Collector → `passed: true`, chama Gemini, `reasoningSource: 'llm'`) | 🔴 Unhappy Path (Vazamento Residual / Pré-Collector → `passed: false`, **0 chamadas ao Gemini [Fail-Closed]**, `reasoningSource: 'fallback'`) |
| :--- | :--- | :--- |
| **1. CPF (Módulo-11 Receita Federal)** | • Log já mascarado `[REDACTED_CPF]`<br/>• `trace_id` OTel de 32 hex (`4bf92f3577b34da6a3ce929d0e0e4736`)<br/>• `commit_sha` de 40 hex<br/>• Float decimal (`4512.11144477735` e `11144477735.99`)<br/>• Sequência de 11 dígitos com Módulo-11 inválido (`12345678900`) ou repetidos (`11111111111`)<br/>• **Idempotência de estado:** executar o guard duas vezes seguidas com o mesmo texto produz exatamente o mesmo resultado (`passed: true`), comprovando ausência de bug de `lastIndex` em regex `/g` | • CPF pontuado (`123.456.789-00` / `111.444.777-35`)<br/>• CPF sem pontuação isolado (`cpf=11144477735`)<br/>• **CPF no fim de frase seguido de ponto (`...falhou para CPF 11144477735.`)**<br/>• **CPF após sublinhado (`user_11144477735`) ou hífen (`CPF-11144477735`)**<br/>• **Chamada dupla:** duas invocações consecutivas contendo CPF inválido resultam em `passed: false` em ambas |
| **2. CNPJ (Módulo-11 Receita Federal)** | • Log já mascarado `[REDACTED_CNPJ]`<br/>• Sequência de 14 dígitos com Módulo-11 inválido ou dígitos repetidos (`11111111111111`) | • CNPJ pontuado (`12.345.678/0001-99` / `11.222.333/0001-81`)<br/>• CNPJ sem pontuação válido no Módulo-11 (`11222333000181`), inclusive no fim de frase com ponto |
| **3. Telefone Celular e Fixo (Regras ANATEL)** | • Log já mascarado `[REDACTED_PHONE]`<br/>• **Timestamps Unix de 10 dígitos (`1734567890`) e 13 dígitos (`1734567890123`)**<br/>• Número de 8 dígitos iniciando com `6` (`(11) 6456-7890` — inválido para fixo pela ANATEL) | • **Celular 9 dígitos (`9XXXX-XXXX`):** `(11) 98765-4321`, `11 98765-4321`<br/>• **Fixo 8 dígitos (`[2-5]XXX-XXXX`):** `(11) 3456-7890`, `11 3456-7890`<br/>• **Internacional E.164 PIX (`+55`):** `+5511987654321`, `+551134567890`<br/>• **Sem máscara em campo contextual:** `pix=11987654321`, `"phone":"11987654321"`, `tel: 1134567890` |
| **4. Chave PIX E-mail (RFC 5322)** | • Log já mascarado `[REDACTED_PIX_EMAIL]`<br/>• Nomes de pacotes `@modelcontextprotocol/sdk` (sem domínio TLD válido após `@`) | • E-mail em texto claro no log ou erro de span (`cliente.silva@exemplo.com.br`) |
| **5. Chave PIX Aleatória (EVP / UUID v4 BACEN)** | • Log já mascarado `pixKey=[REDACTED_PIX_EVP]`<br/>• **UUID v4 técnico comum sem rótulo PIX (`request_id=123e4567-e89b-42d3-a456-426614174000`, `incident_id=...`)**<br/>• UUID v1 (3º bloco não iniciado por `4`) | • UUID v4 RFC 4122 (`4xxx-[89ab]xxx`) precedido por contexto PIX: `pixKey=123e4567-e89b-42d3-a456-426614174000`, `"chave_pix": "123e4567-e89b-42d3-a456-426614174000"`, `evp: 123e4567-...` |
| **6. Credenciais Bearer & JWT** | • Log já mascarado `Bearer [REDACTED_TOKEN]` | • Header `Bearer <token>`<br/>• **JWT cru sem a palavra `Bearer`**, tanto longo quanto com **payload curto (`eyJhbGciOiJIUzI1NiJ9.e30.sig`)** |

---

### 4.2 Integração HTTP: Fluxo de Incidente, MCP, FinOps e Governança HMAC
Testado via `Supertest` usando os helpers de `test/helpers/http-test-client.ts`:

| Fluxo Integrado | 🟢 Happy Path | 🔴 Unhappy Path |
| :--- | :--- | :--- |
| **1. Ingestão de Alerta (`POST /webhook/grafana-alert`)** | • Token `GRAFANA_WEBHOOK_TOKEN` válido → `202 Accepted`, cria incidente e inicia pipeline assíncrono<br/>• Segundo alerta com mesmo `fingerprint` enquanto aberto → deduplica e retorna o incidente existente | • Sem token ou usando `DASHBOARD_API_TOKEN` / `MCP_AUTH_TOKEN` → `401 Unauthorized`<br/>• Payload malformado (sem `alerts` ou `service`) → `400 Bad Request` (Zod) |
| **2. Coleta MCP & `EvidenceCoverage` (`POST /mcp`)** | • 4 sinais presentes (PromQL + Exemplar `trace_id` + Span de erro no Tempo + Log no Loki & Diff `v2.14.7...v2.14.8` no GitHub) → `EvidenceCoverage = 100% (4/4)`, payload podado (≤ 5 séries, ≤ 100 linhas, ≤ 1500 chars diff) e `finops` calculado | • Chamada ao MCP sem `MCP_AUTH_TOKEN` → `401`<br/>• Ausência parcial de sinal (ex.: métrica sem exemplar ou diff sem commit suspeito) → degradação linear para `75% (3/4)` ou `50% (2/4)` sem abortar o diagnóstico<br/>• Indisponibilidade total da API do Gemini → fallback determinístico (`reasoningSource: 'fallback'`) |
| **3. Isolamento do HMAC & Decisão Humana (`POST /api/incidents/:id/decision`)** | • Link no e-mail usa fragmento `#action=approve&sig=<HMAC>&exp=<TS>`<br/>• `POST /api/incidents/:id/decision` com `sig` válido e `exp` dentro de 15 min → `200 OK`, transiciona FSM para `RESOLVED` (ou `REJECTED`) e anota no Grafana | • `GET /api/incidents/:id` e stream SSE `incident.notified` **jamais expõem `sig` (`approveSig`/`rejectSig`)**<br/>• Assinatura `sig` adulterada ou de outro `incidentId` → `401 Unauthorized`<br/>• Timestamp `exp` expirado (> 15 min) → `401 Unauthorized`<br/>• **Segunda tentativa de decisão sobre incidente já `RESOLVED` ou `REJECTED` → `409 Conflict` (`InvalidTransitionError`)** |
| **4. Escape de XSS no Post-Mortem (`renderPostMortem`)** | • HTML gerado contém Evidence Coverage, Reasoning Source, Blast Radius e links `#fragment` | • Injeção `<script>alert(1)</script>` no resumo do RCA ou nome do serviço é escapada (`&lt;script&gt;`) |

---

## 5. Métricas de Qualidade no GitHub Actions CI/CD
| Verificação | Critério | Workflow |
| :--- | :--- | :--- |
| Suíte de Integração (Happy + Unhappy Paths) + Funções de Apoio | 100 % passando + Cobertura ≥ 80 % em `domain/` e `application/` (bloqueante) | `ci.yml` |
| ESLint (incluindo fronteira hexagonal) + Prettier | 0 erros (bloqueante) | `ci.yml` |
| `tsc --noEmit` | 0 erros (bloqueante) | `ci.yml` |
| Segredos vazados (`gitleaks`) | 0 ocorrências (bloqueante) | `ci.yml` |
| Auditoria de dependências (`pnpm audit --prod --audit-level=critical`) | 0 vulnerabilidades `critical` (bloqueante) | `ci.yml` |
| Suíte de regressão nos PRs autônomos (`hotfix/zeromttr-*`) | 100 % verde + comentário no PR | `hotfix-verify.yml` |
| Build & Push de imagens (`ghcr.io`) | Sucesso nos 4 serviços | `cd-release.yml` |

## 6. Definition of Done (Por Fase / Pull Request)
- [ ] Helpers de teste (`test/helpers/`) criados sem duplicação de código HTTP
- [ ] Testes de integração (*Happy Paths* + *Unhappy Paths*) e de funções de apoio escritos primeiro e passando
- [ ] `pnpm run check:workspace` 100 % verde
- [ ] Sem segredos, sem PII e sem referências a artefatos externos não versionados
- [ ] Critérios de aceite do documento `tech/NN` correspondente cumpridos
