# TECH 04 — Integrações Externas: GitHub REST API (Diff & PR) e Resend

**Depende de:** [02](./02_mcp_server.md) · **Consumido por:** [05](./05_orchestrator.md)
**Objetivo:** adapters HTTP rápidos, idempotentes e isolados por portas para inspeção de regressão em deploy (`RepoInspectorPort`), abertura autônoma de Pull Request (`RemediationPort`) e notificação com governança humana (`NotifierPort`).

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
Onde `RemediationPrReceipt` retorna `{ branchName: string; branchUrl: string; pullRequestUrl: string; commitSha: string }`, alinhado ao contrato SSE `incident.remediation` e `IncidentDetail.remediation` ([08 §4.2–4.3](./08_dashboard_frontend.md)).

## 2. GitHub Deploy & Code Inspector (`RepoInspectorPort` — `inspect_git_deploy_diff`)
- **Objetivo:** substituir buscas genéricas na web pela investigação exata que um SRE Sênior realiza quando uma anomalia surge após um deploy: comparar a versão anterior saudável (`base_ref`, ex.: `v2.14.7`) com a versão degradada atual (`head_ref`, ex.: `v2.14.8`) e ler o arquivo suspeito dentro de `TARGET_SERVICE_PATH` (`apps/target-app-demo`).
- **Comportamento:**
  - Consulta `GET /repos/{owner}/{repo}/compare/{base}...{head}` e `GET /repos/{owner}/{repo}/contents/{path}` para obter o diff e o conteúdo atual (incluindo o `sha` do blob) do arquivo suspeito.
  - Filtra apenas arquivos dentro de `service_path` (`apps/target-app-demo`).
  - Cache em memória por `hash(base+head+service_path)` com TTL (evita rate-limit).
  - Calcula telemetria **FinOps** (`raw_bytes_fetched` do payload bruto do GitHub vs. `compacted_bytes_sent_to_llm` após filtrar e truncar os hunks relevantes a ≤ 1500 chars/arquivo).
  - Fallback determinístico resiliente: se as tags `v2.14.7`/`v2.14.8` ainda não existirem no remoto (`404`), consulta diretamente `GET /repos/{owner}/{repo}/contents/{service_path}/src/chaos/pool-saturation.ts` na branch padrão do GitHub (ou localmente se offline) e retorna o hunk canônico de regressão `v2.14.7...v2.14.8` sem interromper o incidente.

## 3. GitHub Autonomous PR Remediation (`RemediationPort` — `create_remediation_pr`)
- **Objetivo:** abrir um Pull Request real, testável e determinístico em **segundos** (~2–5 s) usando a API REST do GitHub (`Octokit` ou `axios` autenticado com `GITHUB_TOKEN`), sem depender de serviços externos lentos.
- **Fluxo na API do GitHub:**
  1. Obtém o SHA da branch padrão (`master` / `main`) em `GET /repos/{owner}/{repo}/git/ref/heads/{defaultBranch}`.
  2. Cria (ou reutiliza, garantindo **idempotência por `incident_id`**) a branch `refs/heads/hotfix/zeromttr-<incident_id>` (`POST /repos/{owner}/{repo}/git/refs`).
  3. Obtém o `sha` atual do blob do arquivo alvo na branch (`GET /repos/{owner}/{repo}/contents/{filePath}?ref=hotfix/zeromttr-<incident_id>`) — requisito obrigatório da API REST do GitHub para atualização de arquivos — e grava o arquivo corrigido (`PUT /repos/{owner}/{repo}/contents/{filePath}` com `content` em Base64, `sha` do blob e `branch`), usando mensagem de commit estruturada (`fix(target-app-demo): resolve db connection pool saturation [incident <id>]`).
  4. Abre o Pull Request (`POST /repos/{owner}/{repo}/pulls`) com título, resumo do RCA, tabela de evidências OTel (PromQL, `trace_id`, Span crítico, Log sanitizado), commit causador identificado no diff e checklist de governança (ou retorna o PR existente se já aberto para a mesma branch); **nunca executa merge automático**.
- **Integração com CI Gate:** a abertura do PR na branch `hotfix/zeromttr-*` aciona automaticamente o workflow `.github/workflows/hotfix-verify.yml`, que roda os testes e publica o selo `✅ ZeroMTTR Autonomous CI Gate: PASSED` nos comentários do PR.
- **Segurança:** o corpo do PR e o commit nunca contêm segredos nem PII.

## 4. Resend (`NotifierPort` — `send_post_mortem_resend`)
- Template HTML em função pura (`renderPostMortem`), com **escape de HTML** em todos os campos dinâmicos, exibindo **RCA Confidence Score** (`confidenceScore`, ex.: `95%`), **Blast Radius** (`blastRadiusServices`), commit/diff causador da regressão, botão para revisar o PR no GitHub, botão secundário para abrir o War Room (`https://zeromttr.agjworks.com`) e rodapé da **AGJ Works (`agjworks.com`)**.
- Remetente autenticado no domínio verificado **`agjworks.com`**: `ZeroMTTR - AGJ Works <sre@zeromttr.agjworks.com>` (configurado via Cloudflare em `send.zeromttr.agjworks.com`), enviando para `ON_CALL_ENGINEER_EMAIL`.
- **Aprovação humana (diferencial):** botões **Aprovar / Rejeitar** apontando para `${PUBLIC_DASHBOARD_URL}/decision/${id}?action=approve|reject&sig=<HMAC>&exp=<TS>` (rota `DecisionComponent` do War Room Dashboard). A confirmação na tela envia `POST /api/incidents/:id/decision` com `{ action, sig, exp }` ao orquestrador, que transiciona a FSM e anota no Grafana.
- **Segurança do link:** clientes de e-mail e scanners fazem *prefetch* de links GET. Por isso o link do e-mail abre a **página de confirmação** no frontend (`/decision/:id`) e a decisão só é efetivada por `POST /api/incidents/:id/decision` (validando o mesmo HMAC + expiração), nunca por um GET com efeito colateral.
- Idempotência via cabeçalho `Idempotency-Key: post-mortem-<incident_id>` do Resend.
- Texto alternativo (plain text) e assunto com severidade.

## 5. Testes (TDD)
| Alvo | Tipo | Cenários |
| :--- | :--- | :--- |
| `formatPrDescription` | unitário | inclui RCA, métricas, trace_id e diff; remove PII; respeita limites |
| `renderPostMortem` | unitário | escapa `<script>`; renderiza Confidence Score, Blast Radius e links HMAC |
| `GithubInspectorHttpAdapter` | contrato (`nock`) | sucesso; 404 tag ausente (usa fallback); truncamento ≤ 1500 chars; FinOps |
| `GithubRemediationHttpAdapter` | contrato (`nock`) | cria branch + commit + PR; idempotência quando branch/PR já existe; erro 422/5xx |
| `ResendHttpAdapter` | contrato (`nock`) | sucesso; erro 4xx; cabeçalho `Idempotency-Key` presente |
| HMAC de decisão | unitário | assinatura válida/inválida/expirada |

## 6. Critérios de aceite
- [ ] Nenhum teste automatizado chama APIs externas reais.
- [ ] Smoke manual (`scripts/smoke-integrations.sh`) valida GitHub API e Resend com chaves reais.
- [ ] `create_remediation_pr` abre um Pull Request real em ≤ 10 s e retorna a URL do PR.
- [ ] E-mail real chega com botões funcionais e conteúdo escapado.
- [ ] Falha de qualquer integração externa é tratada com estado explícito na FSM (sem exceção não tratada).
