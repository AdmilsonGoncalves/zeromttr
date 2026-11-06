# TECH 07 — Demonstração, Medição de MTTR e Documentação Final (Fases 5–6)

**Depende de:** [05](./05_orchestrator.md) · **Objetivo:** consolidar o sistema em uma entrega demonstrável, documentada e reproduzível em ambiente local e em produção.

## 1. Roteiro de verificação ponta a ponta (3 minutos)
| Tempo | Etapa | Evidência verificada |
| :--- | :--- | :--- |
| 0:00 | Contextualização operacional (MTTD/MTTR manual vs. automatizado) | Indicadores de baseline no War Room |
| 0:20 | App saudável no Grafana & War Room | Status `healthy` (`v2.14.7`) |
| 0:40 | Botão "Simular Incidente" ou `scripts/chaos.sh` liga a falha (`v2.14.8`) | Latência/erros sobem |
| 1:00 | Alerta dispara → incidente `RECEIVED` | Stream SSE / anotações no Grafana |
| 1:15 | RCA determinístico em ≤ 15 s | Trace com span crítico (`pg.pool.acquire`) + prova visual Antes/Depois de PII |
| 1:30 | **GitHub Inspector** isola a regressão no diff `v2.14.7...v2.14.8` | Commit e arquivo suspeito exibidos na Aba 3 |
| 1:45 | **GitHub Remediation** abre o Pull Request (`hotfix/zeromttr-*`) | PR real no GitHub + selo verde do `hotfix-verify.yml` |
| 2:00 | **Resend** envia o post-mortem | E-mail com Confidence Score (95%), Blast Radius e botões HMAC |
| 2:20 | Aprovação humana → `RESOLVED` | Linha do tempo + MTTR medido |
| 2:45 | Consolidação das métricas | Comparativo KPI antes × depois + economia FinOps (94%) |

## 2. Medição de MTTR
`scripts/measure-mttr.sh` lê as transições do incidente (`GET /api/incidents/:id`) e imprime: tempo até RCA, até PR, até e-mail, total. Registrar baseline manual (tempo estimado/cronometrado de um engenheiro executando os mesmos passos) para comparação.

## 3. Documentação para o repositório público
- `README.md` (en-US) e `README.pt-BR.md`: problema, arquitetura (diagramas C4/FSM), stack tecnológica (OTel, LGTM, MCP, GitHub API, Gemini, Resend, Angular/PrimeNG), quick start de ≤ 3 comandos, variáveis de ambiente, como rodar o cenário de simulação, testes, limitações conhecidas, licença.
- `docs/pt-BR/adr/` com os ADRs 001–009.
- `CONTRIBUTING.md` curto (TDD, commits, DoD).
- `SECURITY.md` curto (escopo, modo demo, credenciais padrão).
- Badge Node.js 24 LTS, CI, licença.

## 4. Checklist de entrega e Deploy na VPS (Traefik + Cloudflare)
- [ ] `docker compose up` funciona em máquina limpa (desenvolvimento local)
- [ ] Na VPS, segredos gravados exclusivamente em arquivo externo ao repositório Git (ex.: `/path/to/secrets/.env` com `chown $VPS_USER:$VPS_USER /path/to/secrets/.env && chmod 600 /path/to/secrets/.env`)
- [ ] Stack subida na VPS com `ENV_FILE_PATH=/path/to/secrets/.env docker compose --env-file "$ENV_FILE_PATH" -f docker-compose.prod.yml up -d` consumindo ≤ 1.8 GB de RAM e sem nenhuma porta de telemetria (`9090`, `3100`, `3200`, `4317`, `5432`) exposta no host (`ss -tulpn`)
- [ ] No Cloudflare (`agjworks.com`), zona configurada com o IP da VPS, domínio de envio `send.zeromttr.agjworks.com` verificado no Resend e *Cache Rule* para `zeromttr.agjworks.com/api/events*` como **Bypass Cache** (eventos SSE chegando em tempo real sem buffer)
- [ ] `.env.example` e `.env.prod.template` completos no repositório; nenhuma chave real no Git (varredura com `gitleaks`)
- [ ] Integrações com GitHub REST API (Diff + PR) e Resend (`sre@zeromttr.agjworks.com`) validadas e cache de Replay populado
- [ ] Release `v1.0.0` com notas e imagens publicadas no GHCR (`ghcr.io`)
- [ ] Demonstração em vídeo/GIF e link do ambiente em produção (`https://zeromttr.agjworks.com`) no README

## 5. Critérios de aceite
- [ ] Fluxo completo executado 3 vezes seguidas sem intervenção manual além do clique de aprovação.
- [ ] MTTR medido e documentado no README.
- [ ] Checklist de entrega 100 % marcado.
