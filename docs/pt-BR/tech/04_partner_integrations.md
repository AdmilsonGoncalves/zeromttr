# TECH 04 — Integrações Externas: GitHub REST API (Repo Alvo) e Resend (HMAC Exclusivo)

**Depende de:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md) · **Consumido por:** [05](./05_orchestrator.md)
**Objetivo:** implementar adapters HTTP rápidos, idempotentes e isolados por portas para inspeção de diff real entre releases (`RepoInspectorPort`), abertura autônoma de Pull Request no repositório-alvo (`RemediationPort`) e notificação com links HMAC exclusivos por e-mail (`NotifierPort`).

## 1. Ports (`apps/mcp-server/src/ports/`)
```ts
interface RepoInspectorPort {
  inspectDeployDiff(req: DeployDiffRequest): Promise<DeployDiffBundle>;
}

interface RemediationPort {
  createPullRequest(req: RemediationPrRequest): Promise<RemediationPrReceipt>;
}

interface NotifierPort {
  sendPostMortem(r: PostMortem): Promise<NotificationReceipt>;
}
```
Onde `RemediationPrReceipt` retorna `{ branchName: string; branchUrl: string; pullRequestUrl: string; commitSha: string }`.

## 2. GitHub Deploy & Code Inspector (`RepoInspectorPort` — `inspect_git_deploy_diff`)
- **Objetivo:** comparar as tags reais `v2.14.7` (saudável) e `v2.14.8` (degradada) no repositório `TARGET_GITHUB_REPO` (`https://github.com/AdmilsonGoncalves/zeromttr`, pasta `apps/target-app-demo`) e obter o conteúdo e o `sha` do arquivo suspeito (`apps/target-app-demo/src/repositories/payment.repository.ts`).
- **Comportamento na API do GitHub:**
  1. Consulta `GET /repos/{owner}/{repo}/compare/{base_ref}...{head_ref}` (`v2.14.7...v2.14.8`).
  2. Filtra arquivos modificados dentro de `service_path` (`apps/target-app-demo`) e extrai o commit autor da mudança, mensagem do commit e *patch* (truncado a ≤ 1500 chars por arquivo).
  3. Consulta `GET /repos/{owner}/{repo}/contents/{filePath}?ref={head_ref}` para obter o conteúdo completo codificado em Base64 e o **`sha` atual do blob** (necessário para o passo de remediação).
  4. Calcula telemetria **FinOps** (`raw_bytes_fetched` do payload bruto da API do GitHub vs. `compacted_bytes_sent_to_llm` após filtrar apenas os hunks relevantes).

## 3. GitHub Autonomous PR Remediation (`RemediationPort` — `create_remediation_pr`)
- **Objetivo:** abrir um Pull Request real, testável e determinístico em **2 a 5 segundos** no repositório `AdmilsonGoncalves/zeromttr` (mirando a branch `TARGET_BASE_BRANCH`, padrão `release/target-v2.14.8`) usando `GITHUB_TOKEN`.
- **Fluxo na API do GitHub:**
  1. Obtém o SHA do topo da branch base (`release/target-v2.14.8`) em `GET /repos/{owner}/{repo}/git/ref/heads/{baseBranch}`.
  2. Cria (ou reutiliza, garantindo **idempotência por `incident_id`**) a branch `refs/heads/hotfix/zeromttr-<incident_id>` (`POST /repos/{owner}/{repo}/git/refs`).
  3. Obtém o `sha` atual do blob do arquivo na branch (`GET /repos/{owner}/{repo}/contents/{filePath}?ref=hotfix/zeromttr-<incident_id>`) e grava o arquivo corrigido (`PUT /repos/{owner}/{repo}/contents/{filePath}` passando `content` em Base64, `sha` do blob e `branch`), com mensagem de commit estruturada (`fix(target-app-demo): release db client in finally block and restore pool size [incident <id>]`).
  4. Abre o Pull Request (`POST /repos/{owner}/{repo}/pulls` com `base: 'release/target-v2.14.8'`) contendo título, resumo do RCA, tabela de evidências OTel, diff da regressão `v2.14.7...v2.14.8`, auditoria zero-PII e checklist de governança; **nunca executa merge automático**.
- **Validação automática por CI:** a abertura do PR dispara o workflow `.github/workflows/hotfix-verify.yml`, que executa o teste de regressão do `@zeromttr/target-app-demo` e comenta o selo `✅ ZeroMTTR Autonomous CI Gate: PASSED` no PR.

## 4. Resend (`NotifierPort` — `send_post_mortem_resend`) com HMAC Exclusivo em URI Fragment (`#`)
- Template HTML em função pura (`renderPostMortem`), com **escape de HTML** em todos os campos dinâmicos, exibindo:
  - **Evidence Coverage Score** (`4/4 Signals — 100%`),
  - **Reasoning Source** (`llm` vs. `fallback`),
  - **Blast Radius** (`services_involved`),
  - **Auditoria Pré-LLM (`PiiPromptGuard`)** (`leakedPatternsDetected: 0`),
  - Commit causador da regressão (`v2.14.7...v2.14.8`),
  - Botão para revisar o Pull Request no GitHub (`AdmilsonGoncalves/zeromttr`),
  - Botões de decisão humana (**Aprovar Hotfix** / **Rejeitar Hotfix**) contendo os links assinados via HMAC-SHA256 no **URI Fragment (`#`)** e TTL curto (15 min):
    `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS>`.
- **Por que usar URI Fragment (`#`) em vez de Query String (`?`) e Configuração do Domínio Resend:**
  - Os navegadores **jamais enviam a parte `#fragment` da URL nas requisições HTTP GET** ao servidor; portanto, a assinatura `sig` **nunca aparece nos access logs do Cloudflare, do Traefik ou do Nginx**.
  - A rota `/decision/:id` do SPA Angular lê `window.location.hash` localmente no navegador e envia `{ action, sig, exp }` exclusivamente no corpo do `POST /api/incidents/:id/decision`.
  - **Preservação do `#fragment` no Resend:** manter o **Click Tracking desabilitado** nas configurações do domínio `zeromttr.agjworks.com` no painel do Resend para garantir que o link `https://zeromttr.agjworks.com/decision/:id#action=...` chegue ao cliente de e-mail sem reescrita de URL intermediária.
- **Isolamento de segurança da assinatura HMAC:**
  - As assinaturas `approveSig` e `rejectSig` são enviadas **exclusivamente dentro do e-mail entregue pelo Resend** ao destinatário `ON_CALL_ENGINEER_EMAIL`.
  - Elas **jamais** são retornadas em `GET /api/incidents/:id` nem emitidas no stream SSE (`incident.notified`).
- Idempotência via cabeçalho `Idempotency-Key: post-mortem-<incident_id>` na chamada à API do Resend.

## 5. Testes (TDD — Integração via `test/helpers/` + Funções de Apoio)
| Alvo | Tipo | Cenários (Happy & Unhappy Paths usando `test/helpers/`) |
| :--- | :--- | :--- |
| `formatPrDescription` & `renderPostMortem` | unitário (apoio puro) | Happy: inclui RCA, métricas, `trace_id`, Evidence Coverage, Blast Radius e links `#fragment`; Unhappy: escapa `<script>` (XSS) e respeita limites |
| `verifyDecisionHmac` | unitário (apoio puro) | Happy: assinatura válida dentro do TTL de 15 min; Unhappy: assinatura adulterada, `incidentId` divergente ou `exp` expirado |
| `inspect_git_deploy_diff` (`GithubInspectorHttpAdapter`) | integração HTTP (`callMcpTool` + `nock`) | Happy: sucesso comparando `v2.14.7...v2.14.8`, extração de `blobSha`, truncamento ≤ 1500 chars e cálculo FinOps; Unhappy: tag inexistente / erro 404 ou 500 na API do GitHub |
| `create_remediation_pr` (`GithubRemediationHttpAdapter`) | integração HTTP (`callMcpTool` + `nock`) | Happy: cria branch + commit com `sha` + PR e idempotência quando branch/PR já existe; Unhappy: conflito 409/422 ou falha 5xx |
| `send_post_mortem_resend` (`ResendHttpAdapter`) | integração HTTP (`callMcpTool` + `nock`) | Happy: sucesso com cabeçalho `Idempotency-Key` e links `#fragment`; Unhappy: erro 4xx/5xx da API do Resend |

## 6. Critérios de Aceite
- [ ] Nenhum teste automatizado chama APIs externas reais.
- [ ] Smoke manual (`scripts/smoke-integrations.sh`) valida chamada real ao modelo `LLM_MODEL` (`gemini-3.5-flash`), `inspect_git_deploy_diff`, `create_remediation_pr` em `AdmilsonGoncalves/zeromttr` e envio de e-mail no Resend.
- [ ] O e-mail chega com os links HMAC funcionais, enquanto o payload SSE `incident.notified` não expõe `sig`.
