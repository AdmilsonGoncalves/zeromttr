---
id: war-room
title: Usando o War Room
slug: /war-room
sidebar_position: 2
---

# Usando o War Room

O **War Room** é a tela única de operação do ZeroMTTR. Ela combina status em tempo real, linha do tempo do incidente, telemetria do serviço monitorado, evidências técnicas e painel de remediação.

## 1. Cabeçalho Superior

Da esquerda para a direita, o cabeçalho exibe:

- **Identidade e status de conexão:** indica se o stream de eventos em tempo real (**SSE**) está conectado (`Online` em verde ou `Offline` em vermelho).
- **Status do serviço monitorado:** mostra o nome do serviço alvo, a versão atual e o estado de saúde:
  - **Saudável (verde):** operando normalmente dentro dos limites.
  - **Degradado (amarelo):** falha ou saturação ativa detectada.
  - **Inacessível (vermelho):** sem resposta ou sem telemetria recente.
- **Controles à direita:**
  - **Demonstração:** abre o menu lateral de simulação (visível apenas quando o modo de demonstração está habilitado).
  - **Configurações (ícone de engrenagem):** abre o painel de políticas operacionais e auditoria (disponível em demonstração e produção).
  - **Manual (`?`):** abre este guia já no idioma selecionado.
  - **Idioma (bandeira):** alterna instantaneamente entre **Português**, **English** e **Español**.

## 2. Fluxo de Remediação

Logo abaixo do cabeçalho, a linha do tempo horizontal acompanha as 8 etapas do incidente em tempo real:

1. **Coleta LGTM** — aguardando disparo do alerta de observabilidade.
2. **Recebido** — alerta validado e incidente criado.
3. **Investigando** — consulta automática de métricas, traces e logs.
4. **Enriquecendo** — inspeção do diff entre a versão saudável e a degradada.
5. **Remediando** — auditoria de privacidade e síntese da causa raiz e do patch.
6. **Abrindo PR** — criação da branch de hotfix e abertura do Pull Request no GitHub.
7. **Notificado** — post-mortem enviado ao plantonista aguardando decisão humana.
8. **Resolvido / Rejeitado** — decisão registrada e incidente encerrado.

:::info Dica visual
Passe o mouse sobre qualquer etapa da linha do tempo para ver o resumo da ação executada naquele estágio.
:::

## 3. Telemetria do Serviço Alvo

Exibe a saúde instantânea do workload monitorado em cartões compactos:

- **Vazão (req/s)** e indicador de tráfego sintético ativo.
- **Taxa de erro 5xx (%)** com cor dinâmica (verde, amarelo ou vermelho conforme severidade).
- **Latência p95 (ms)** indicando degradação de tempo de resposta.
- **Saturação de recurso** (quando reportada pelo serviço, como pool de banco ou fila de workers) com contagem de recursos ativos e em espera.

## 4. Faixa de KPIs

Resume os indicadores-chave do incidente ativo:

- **TTD (Time to Diagnose):** tempo entre o recebimento do alerta e a conclusão do diagnóstico.
- **TTPR (Time to Pull Request):** tempo até a abertura do Pull Request de correção.
- **Cobertura de Evidências:** porcentagem de sinais independentes coletados (métricas, exemplar, trace de erro e log/diff — até `4/4` = `100%`).
- **Fonte do Diagnóstico:** indica se a análise foi sintetizada via **Provedor LLM** ou **Fallback Determinístico** (caso o LLM esteja indisponível ou bloqueado por privacidade).
- **Redução FinOps:** porcentagem de compactação aplicada aos dados brutos antes do envio à IA e estimativa de tokens economizados.

## 5. Painel de Evidências (4 Abas)

- **Telemetria ao Vivo:** séries temporais recentes de latência p95, erros 5xx, vazão e saturação.
- **Trace Tree & Evidências:** árvore distribuída de spans destacando o span crítico com erro, raio de impacto (_blast radius_) e resumo da causa raiz.
- **Logs Loki & Mascaramento PII:** comparação lado a lado entre o log bruto na borda (com PII sintética) e o log efetivamente armazenado após mascaramento, além do resultado da auditoria _fail-closed_.
- **Git Deploy Diff & FinOps:** trecho de código alterado entre releases e comparativo visual de bytes brutos vs. compactados.

## 6. Painel de Remediação

Exibe o status do **Pull Request no GitHub** (com link direto para revisão), uma prévia sanitizada do **e-mail Post-Mortem** enviado ao plantonista e, no modo de demonstração, o botão para simular a aprovação na tela.
