---
id: scope-and-limits
title: Escopo, Limitações e Governança
slug: /scope-and-limits
---

# Escopo, Limitações e Governança

Esta página documenta com transparência **o que o ZeroMTTR faz automaticamente**, **o que ele intencionalmente não faz** e os **limites operacionais da arquitetura atual**.

## 1. Sem merge automático nem redeploy em produção

Por decisão deliberada de governança (**Human-in-the-Loop**), o ZeroMTTR **nunca realiza merge automático de Pull Requests nem dispara deploys em produção**.

| Ação                                                                        | Executada pelo ZeroMTTR? | Quem executa                                                                       |
| :-------------------------------------------------------------------------- | :----------------------- | :--------------------------------------------------------------------------------- |
| Investigar métricas, traces, logs mascarados e diff de deploy               | Sim                      | Automático (Orchestrator + MCP Server)                                             |
| Gerar diagnóstico (RCA) e abrir branch `hotfix/zeromttr-*` com Pull Request | Sim                      | Automático (validado por CI quando o repositório alvo possui workflow configurado) |
| Enviar e-mail Post-Mortem com links assinados (HMAC)                        | Sim                      | Automático                                                                         |
| Validar HMAC, encerrar incidente (`RESOLVED`) e anotar no Grafana           | Sim (após clique humano) | Engenheiro de plantão confirma na tela de decisão                                  |
| **Fazer merge do Pull Request na branch alvo / produção**                   | **Não**                  | **Sempre manual pelo engenheiro diretamente no GitHub**                            |
| **Disparar build/redeploy em produção após o merge**                        | **Não**                  | **Pipeline de deploy controlado pela equipe responsável**                          |

:::important Sobre a opção "Restauração Automática ao Aprovar"
A configuração `autoRestoreOnApprove` existe **apenas para ambientes de demonstração** com alvos que suportam simulação de caos em memória. Em produção (ou em serviços monitorados passivamente), clicar em **Aprovar** apenas registra a decisão auditável, encerra o incidente e anota o evento no Grafana.
:::

## 2. Escopo e limites da proteção de privacidade (PII)

O ZeroMTTR aplica uma **dupla barreira independente** — mascaramento OTTL na borda (OTel Collector) e auditoria _fail-closed_ pré-LLM (`PiiPromptGuard`) — sobre os seguintes padrões estruturados:

- **Coberto deterministicamente:**
  - **CPF e CNPJ** (com validação de dígitos verificadores Módulo-11, com ou sem pontuação);
  - **Telefones celulares e fixos** (padrão brasileiro ANATEL);
  - **Endereços de e-mail**;
  - **Chaves aleatórias EVP / UUID v4** quando acompanhadas de marcador contextual de chave PIX (`pix`, `pixKey`, `chave_pix`, `evp`);
  - **Credenciais e tokens `Bearer` / JWT** (incluindo estrutura `eyJ...` mesmo sem o prefixo `Bearer`).
- **Fora do escopo determinístico atual:**
  - **Nomes próprios, endereços físicos ou informações sensíveis em texto livre** sem padrão estrutural fixo;
  - **Telefones sem formatação ou UUIDs v4 sem marcador contextual** (excluídos intencionalmente para evitar falsos positivos com IDs de correlação, trace IDs e timestamps Unix);
  - **Dados sensíveis fora de logs/texto** (séries numéricas brutas de métricas no Prometheus não passam por inspeção textual).

## 3. Comportamento em falha de IA (`fail-closed` e fallback)

- Se o `PiiPromptGuard` detectar **qualquer** padrão residual não mascarado, o envio ao provedor de IA externo é **abortado imediatamente** (_fail-closed_).
- Tanto em caso de bloqueio por privacidade quanto de indisponibilidade/timeout da API do LLM, o orquestrador conclui o fluxo utilizando **fallback determinístico local** e sinaliza explicitamente `reasoningSource: 'fallback'` no War Room, no stream SSE e no corpo do Pull Request.
- A qualidade do patch gerado pelo modelo de IA depende diretamente da clareza do diff de deploy e da cobertura dos sinais de telemetria coletados; por isso a revisão humana do PR no GitHub é sempre obrigatória.

## 4. Escala, persistência e alta disponibilidade

A arquitetura atual foi desenhada como uma plataforma enxuta e _self-hosted_ de nó único (_single-node_):

- **Sem multi-tenant:** uma instância do ZeroMTTR opera um ambiente/equipe por vez.
- **Sem alta disponibilidade multi-nó:** orquestrador, servidor MCP e stack LGTM rodam em contêineres únicos via Docker Compose.
- **Persistência enxuta:**
  - **Configurações operacionais e auditoria:** armazenadas em banco **SQLite local** no volume do orquestrador;
  - **Histórico de incidentes:** mantido em memória com snapshot em arquivo JSON (sem banco relacional dedicado para histórico de longo prazo);
  - **Métricas, logs e traces (stack LGTM):** retenção de curto prazo voltada à investigação operacional recente (padrão de 24 horas no Prometheus).

## 5. Separação entre Demonstração e Produção

- Em ambientes públicos de demonstração, visitantes anônimos executam por padrão o **Modo Replay** (dados gravados), enquanto execuções reais (**Modo Live**) podem ser protegidas por chave dedicada, Cloudflare Turnstile e cooldown global entre disparos.
- Para uso exclusivo em produção, defina `ENABLE_DEMO_MODE=false` no orquestrador: isso oculta o menu **Demonstração** no War Room e desabilita completamente as rotas `/api/demo/*`.
