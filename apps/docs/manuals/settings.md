---
id: settings
title: Configurações em Tempo Real
slug: /settings
---

# Configurações em Tempo Real

O ícone de **engrenagem** no canto superior direito do War Room abre o painel **Configurações**, sempre disponível tanto em modo de demonstração quanto em produção.

As alterações são salvas localmente com persistência em banco SQLite e passam a valer **imediatamente**, sem precisar reiniciar contêineres.

## Abas disponíveis

### 1. Alertas e Decisões

- **Cooldown pós-rejeição (Human Takeover)** (`REJECTION_COOLDOWN_SECONDS`, `0`–`86400s`, padrão `900s`): tempo em que novos alertas idênticos são suprimidos após uma rejeição humana. Quando um alerta é suprimido, o War Room exibe um aviso (toast) com o tempo restante.
- **Supressão de repetição** (`REPEAT_SUPPRESSION_SECONDS`, `0`–`86400s`, padrão `60s` local / `900s` produção): intervalo mínimo antes de abrir um novo incidente para o mesmo problema após um encerramento (`RESOLVED` ou `REJECTED`). Quando um alerta é suprimido, o War Room exibe um aviso (toast) indicando o tempo restante e o atalho para esta aba.
- **Validade do link de decisão (TTL)** (`DECISION_TTL_SECONDS`, `60`–`86400s`, padrão `900s`): tempo de expiração dos links assinados enviados no e-mail Post-Mortem.
- **Restaurar alvo ao aprovar** (`AUTO_RESTORE_ON_APPROVE`, padrão `true` em demo local / `false` em `.env.prod.template`): define se a aprovação deve acionar a restauração automática no serviço de demonstração (desabilitado automaticamente quando `ENABLE_DEMO_MODE=false`).

### 2. Serviço Alvo

- **Caminho do serviço no repositório** (`TARGET_SERVICE_PATH`): pasta inspecionada ao analisar diffs.
- **Referências base e degradada** (`TARGET_BASE_REF` / `TARGET_HEAD_REF`): tags ou refs comparadas na investigação de regressão.
- **Limiar de taxa de erro 5xx (%)** (`TARGET_ERROR_RATE_THRESHOLD_PERCENT`, `0.1`–`100`): percentual acima do qual um serviço monitorado via Prometheus é classificado como degradado.
- **Informações somente leitura:** repositório GitHub configurado (`TARGET_GITHUB_REPO`), branch base dos PRs (`TARGET_BASE_BRANCH`), provedor de status ativo (`TARGET_STATUS_PROVIDER`) e intervalo de reenvio do Grafana (`GRAFANA_ALERT_REPEAT_INTERVAL`, padrão `1m` local / `15m` produção — somente leitura porque exige recriar o contêiner `grafana` após alterar o `.env`).

### 3. IA e Observabilidade

- **Modelo LLM principal e de fallback** (`LLM_MODEL` / `LLM_FALLBACK_MODEL`): modelos utilizados pelo provedor ativo (`LLM_PROVIDER`: Gemini, OpenAI, `openai-compatible`, OpenRouter, Groq, DeepSeek, Ollama, vLLM ou Anthropic) na síntese de diagnóstico e patch, com suporte a identificadores com namespace (ex.: `openai/gpt-4o-mini`).
- **E-mail do plantonista** (`ON_CALL_ENGINEER_EMAIL`): exibido sempre de forma mascarada (`on***@example.com`) para evitar exposição de PII na tela.
- **Nível de log do orquestrador** (`LOG_LEVEL`): ajustável em tempo real (`debug`, `info`, `warn`, `error`).

### 4. Auditoria

- Lista cronológica das alterações feitas nas configurações, exibindo data/hora (UTC), campo alterado, valor anterior e novo valor (com e-mails sempre mascarados).

## Precedência entre SQLite e `.env`

- Valores salvos pelo painel **Configurações** ficam gravados no volume SQLite (`SETTINGS_DB_PATH`) e têm **precedência sobre o `.env`** mesmo após recriar o contêiner `orchestrator`.
- **Exceção de troca de provedor LLM:** `LLM_PROVIDER` é lido sempre do `.env` na inicialização; ao trocar `LLM_PROVIDER`, overrides anteriores de `llmModel` e `llmFallbackModel` no SQLite são limpos automaticamente para evitar incompatibilidade entre provedores.

## Controle de acesso e modo somente leitura

- **Ambiente protegido por token:** para salvar alterações, informe o **Token de Administrador de Configurações** no topo do painel. O token fica guardado apenas na sessão atual do navegador (`sessionStorage`) e é limpo ao fechar a aba.
- **Modo somente leitura:** em instâncias públicas de demonstração onde o token administrativo não foi configurado, o painel permite consultar todas as configurações e a auditoria, mas mantém a edição bloqueada por segurança.
