---
id: installation-troubleshooting
title: Instalação Local e Troubleshooting
slug: /installation-troubleshooting
---

# Instalação Local e Troubleshooting

## Requisitos

- **Node.js 24 LTS**
- **pnpm 12+**
- **Docker & Docker Compose v2.40+**

## Subindo o ambiente local

```bash
# 1. Copiar o modelo de variáveis de ambiente
cp .env.prod.template .env

# 2. (Opcional para Modo Replay; obrigatório para Modo Live)
# Edite o .env e preencha suas credenciais reais:
# LLM_API_KEY, GITHUB_TOKEN, RESEND_API_KEY, ON_CALL_ENGINEER_EMAIL
# e substitua os tokens de segurança (MCP_AUTH_TOKEN, GRAFANA_WEBHOOK_TOKEN,
# DASHBOARD_API_TOKEN, SETTINGS_ADMIN_TOKEN e DECISION_HMAC_SECRET)

# 3. Instalar dependências
pnpm install --frozen-lockfile

# 4. Validar qualidade do workspace (formatação, lint, tipos, testes e build)
pnpm run check:workspace

# 5. Subir toda a stack (Observabilidade LGTM + ZeroMTTR + Manual)
docker compose up -d --build
```

## Endereços locais

| Serviço                               | URL                         |
| :------------------------------------ | :-------------------------- |
| **War Room Dashboard**                | `http://localhost:4200`     |
| **Manual de Instruções (Docusaurus)** | `http://localhost:4300`     |
| **Grafana**                           | `http://localhost:3000`     |
| **Prometheus**                        | `http://localhost:9090`     |
| **Servidor MCP**                      | `http://localhost:8000/mcp` |

## Rodando scripts CLI no host

O projeto oferece scripts auxiliares em `scripts/` para tarefas pontuais via terminal:

- `./scripts/reset.sh` — restaura o serviço de exemplo e limpa PRs temporários de hotfix no GitHub.
- `./scripts/chaos.sh` — injeta saturação de pool e gera carga sintética via CLI.
- `./scripts/record-replay.sh` — grava um novo snapshot sanitizado para o Modo Replay.
- `./scripts/load-test-lgtm.sh` — executa teste de carga e audita consumo de RAM dos contêineres.

:::warning Atenção ao rodar scripts no host com `.env`
O arquivo `.env.prod.template` define `TARGET_APP_URL=http://target-app-demo:3001` (hostname interno da rede Docker). Ao rodar os scripts diretamente na sua máquina host, sobrescreva a URL **inline no comando**:

```bash
TARGET_APP_URL=http://127.0.0.1:3001 ./scripts/reset.sh
```

**Não** coloque `export TARGET_APP_URL=http://127.0.0.1:3001` no `~/.zshrc` ou `~/.bashrc`, pois o Docker Compose prioriza variáveis do shell sobre o `.env` e quebraria a comunicação entre os contêineres.
:::

## Solução de problemas comuns

| Sintoma                                        | Causa provável                                                        | Como resolver                                                                                                                                                   |
| :--------------------------------------------- | :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSE Offline** no cabeçalho do War Room       | Orquestrador ainda inicializando ou fora do ar.                       | Verifique `docker compose ps` e `docker compose logs orchestrator`.                                                                                             |
| **HTTP 403** ao acionar Modo Live              | Chave `LIVE_DEMO_KEY` ausente/inválida ou desafio Turnstile expirado. | Informe a chave no painel **Demonstração** ou complete o Turnstile novamente.                                                                                   |
| **HTTP 429** ao simular incidente              | Janela de cooldown (2 min) ou rate limit ativo.                       | Aguarde os segundos informados no aviso antes de tentar novamente.                                                                                              |
| **Configurações em modo somente leitura**      | `SETTINGS_ADMIN_TOKEN` não configurado em ambiente demo.              | Defina `SETTINGS_ADMIN_TOKEN` no `.env`, recrie o serviço (`docker compose up -d --force-recreate orchestrator`) e informe o token no painel **Configurações**. |
| **Serviço alvo como `Inacessível`**            | Alvo offline ou sem métricas recentes no Prometheus.                  | Confirme que o serviço está saudável (`GET /health`) e enviando telemetria OTLP ao Collector.                                                                   |
| **Link de decisão expirado ou `409 Conflict`** | TTL do link excedido ou incidente já aprovado/rejeitado.              | Cada incidente aceita uma única decisão dentro do prazo configurado (padrão 15 min).                                                                            |
