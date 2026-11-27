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

- **Cooldown pós-rejeição (Human Takeover):** tempo em que novos alertas idênticos são suprimidos após uma rejeição humana.
- **Supressão de repetição:** intervalo mínimo antes de abrir um novo incidente para o mesmo problema após um encerramento.
- **Validade do link de decisão (TTL):** tempo de expiração dos links assinados enviados no e-mail Post-Mortem.
- **Restaurar alvo ao aprovar:** define se a aprovação deve acionar a restauração automática no serviço de demonstração (desabilitado automaticamente quando o modo demo está desligado).

### 2. Serviço Alvo

- **Caminho do serviço no repositório:** pasta inspecionada ao analisar diffs.
- **Referências base e degradada:** tags ou refs comparadas na investigação de regressão.
- **Limiar de taxa de erro 5xx (%):** percentual acima do qual um serviço monitorado via Prometheus é classificado como degradado.
- **Informações somente leitura:** repositório GitHub configurado, branch base dos PRs, provedor de status ativo e intervalo do Grafana.

### 3. IA e Observabilidade

- **Modelo LLM principal e de fallback:** modelos utilizados pelo provedor ativo (`LLM_PROVIDER`: Gemini, OpenAI, `openai-compatible`, OpenRouter, Groq, DeepSeek, Ollama, vLLM ou Anthropic) na síntese de diagnóstico e patch, com suporte a identificadores com namespace (ex.: `openai/gpt-4o-mini`).
- **E-mail do plantonista:** exibido sempre de forma mascarada (`on***@example.com`) para evitar exposição de PII na tela.
- **Nível de log do orquestrador:** ajustável em tempo real (`debug`, `info`, `warn`, `error`).

### 4. Auditoria

- Lista cronológica das alterações feitas nas configurações, exibindo data/hora (UTC), campo alterado, valor anterior e novo valor (com e-mails sempre mascarados).

## Controle de acesso e modo somente leitura

- **Ambiente protegido por token:** para salvar alterações, informe o **Token de Administrador de Configurações** no topo do painel. O token fica guardado apenas na sessão atual do navegador (`sessionStorage`) e é limpo ao fechar a aba.
- **Modo somente leitura:** em instâncias públicas de demonstração onde o token administrativo não foi configurado, o painel permite consultar todas as configurações e a auditoria, mas mantém a edição bloqueada por segurança.
