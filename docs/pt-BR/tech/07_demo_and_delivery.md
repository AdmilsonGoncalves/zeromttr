# TECH 07 — Demonstração Live, Medição de TTD/TTPR e Entrega Final (Fases 5–6)

**Depende de:** [05](./05_orchestrator.md), [08](./08_dashboard_frontend.md)
**Objetivo:** consolidar o sistema em uma demonstração ao vivo de 3 minutos (modo `Live` real + cliente MCP externo), documentar o baseline cronometrado de **TTD** e **TTPR** e congelar o ambiente de produção para avaliação.

## 1. Roteiro da Demonstração em Vídeo (3 Minutos — Modo `Live` Real)
Como visitantes anônimos na URL pública veem por padrão o modo `Replay` (para proteção de cotas), **o vídeo de demonstração grava obrigatoriamente o modo `Live` real de ponta a ponta**, além de demonstrar o contrato MCP aberto em um cliente externo:

| Tempo | Etapa | Evidência Demonstrada ao Vivo |
| :--- | :--- | :--- |
| **0:00 – 0:25** | Problema Operacional & Arquitetura Aberta | Contextualização na trilha **Logística & Automação** (automação de fluxos de trabalho e integração entre sistemas): diferencial de PII mascarada na borda + FinOps de tokens + contrato MCP aberto e agnóstico ao serviço monitorado. |
| **0:25 – 0:45** | Contrato MCP Aberto (Cliente Externo) | **MCP Inspector** (ou Cursor/Claude Desktop via `.mcp.json`) conectado diretamente ao `zeromttr-mcp-server`, listando as 8 tools (`tools/list`) e invocando `execute_promql_range`. |
| **0:45 – 1:10** | Disparo do Incidente Real (`⚡ Live API Mode`) | Clique em "Simular Incidente" no War Room; `api-pagamentos-core` entra em `degraded` (`v2.14.8`); Grafana dispara alerta para o Orchestrator. |
| **1:10 – 1:40** | Mascaramento OTTL na Borda & Coleta OTel (`TTD ≤ 15s`) | Aba 1 mostra `Evidence Coverage: 4/4 Signals (95%)` + `Blast Radius` + span `pg.pool.acquire` em erro; Aba 2 mostra o log bruto antes do Collector vs. log mascarado pelo `transform` OTTL (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `Bearer [REDACTED_TOKEN]`) e a auditoria do `PiiPromptGuard` (`0 PII patterns in LLM prompt`). |
| **1:40 – 2:10** | Diff Real `v2.14.7...v2.14.8` & PR Autônomo (`TTPR ≤ 30s`) | Aba 3 mostra o diff extraído do repositório-alvo `zeromttr-target-demo` (`PaymentRepository.ts`) e a economia FinOps (`~94% context compression`). Clique no link abre no GitHub o **Pull Request real recém-criado** com o comentário `✅ ZeroMTTR Autonomous CI Gate: PASSED` postado pelo `hotfix-verify.yml`. |
| **2:10 – 2:40** | Post-Mortem no Resend & Aprovação Humana via HMAC | Exibição do e-mail real recebido via **Resend** (`sre@zeromttr.agjworks.com`); clique no botão **Aprovar Hotfix** do e-mail abre `/decision/:id`, confirma via `POST` com assinatura HMAC e muda o estado para `RESOLVED` + anotação no gráfico do Grafana. |
| **2:40 – 3:00** | Fechamento com Métricas Cronometradas | Comparação entre o baseline manual cronometrado (7 passos) e o TTD/TTPR medido pelo `scripts/measure-mttr.sh`. |

## 2. Medição Honesta de TTD e TTPR vs. Baseline Manual Cronometrado
O script `scripts/measure-mttr.sh` lê os timestamps de transição de `GET /api/incidents/:id` e calcula:
1. **TTD (*Time to Deterministic Diagnosis*):** `timestamp(REMEDIATING) - timestamp(RECEIVED)` (meta: ≤ 15 s).
2. **TTPR (*Time to Reviewable Pull Request*):** `timestamp(AWAITING_PR/NOTIFIED) - timestamp(RECEIVED)` (meta: ≤ 30 s).
3. **Tempo até Post-Mortem Entregue:** `timestamp(NOTIFIED) - timestamp(RECEIVED)` (meta: ≤ 45 s).

Para comparação justa no README, cronometrar e registrar uma execução manual real dos mesmos 7 passos feitos por um engenheiro (1. ler alerta; 2. rodar PromQL; 3. abrir exemplar no Tempo; 4. filtrar Loki pelo `trace_id`; 5. rodar `git diff v2.14.7..v2.14.8` no repo-alvo; 6. editar `PaymentRepository.ts` e rodar testes; 7. criar branch e abrir PR).

## 3. Documentação Obrigatória no Repositório Público
- `README.md` (en-US) e `README.pt-BR.md`:
  - Declaração explícita da trilha **Logística & Automação** (automação de fluxos de trabalho operacionais e integrações entre sistemas) e da arquitetura agnóstica de domínio.
  - Tabela comparativa de posicionamento (HolmesGPT / OpenSRE / Bits AI vs. ZeroMTTR).
  - Explicação transparente do **Modo `Live` vs. Modo `Replay`** na demo pública (`https://zeromttr.agjworks.com`) e como qualquer avaliador pode testar em modo `Live` (localmente via Docker Compose ou com a chave `LIVE_DEMO_KEY` fornecida na submissão).
  - Como conectar um cliente MCP externo usando o arquivo `.mcp.json` da raiz.
  - Link para o repositório-alvo `https://github.com/AdmilsonGoncalves/zeromttr-target-demo` contendo as tags `v2.14.7` e `v2.14.8` e os Pull Requests abertos pelo agente.
- `docs/pt-BR/adr/` com os ADRs 001–009.
- `CONTRIBUTING.md` e `SECURITY.md`.

## 4. Checklist de Entrega e Estabilidade em Produção
- [ ] `docker compose up` funciona em máquina limpa (desenvolvimento local).
- [ ] Repositório-alvo `AdmilsonGoncalves/zeromttr-target-demo` público com as tags `v2.14.7` e `v2.14.8` e workflow `hotfix-verify.yml` funcional.
- [ ] Na VPS, segredos gravados exclusivamente em arquivo externo ao repositório Git (ex.: `/path/to/secrets/.env` com permissão `600`) contendo os 3 tokens segregados (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`).
- [ ] Stack testada sob carga na VPS consumindo ≤ 2.2 GB de RAM, sem OOMKill no Prometheus/Loki/Tempo e sem nenhuma porta de telemetria exposta no host (`ss -tulpn`).
- [ ] Release `v1.0.0` publicada e **deploy na VPS congelado** (sem deploys automáticos em pushes soltos) para garantir 100% de disponibilidade durante todo o período de avaliação.
- [ ] Vídeo de 3 minutos gravado em modo `Live` real e publicado no README.
