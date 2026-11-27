---
id: demo-modes
title: Modo Replay vs. Modo Live
slug: /demo-modes
sidebar_position: 3
---

# Modo Replay vs. Modo Live

Quando o ambiente de demonstração está ativo, o botão **Demonstração** no topo do War Room abre um painel lateral com dois modos de operação.

## Comparação rápida

| Característica            | Modo Replay (padrão público)                    | Modo Live (execução real)                                 |
| :------------------------ | :---------------------------------------------- | :-------------------------------------------------------- |
| **Duração típica**        | ~25 segundos                                    | ~30–60 segundos                                           |
| **Consome APIs externas** | Não (cotas de LLM, GitHub e e-mail preservadas) | Sim (LLM real, PR real e e-mail real)                     |
| **Altera o serviço alvo** | Não                                             | Sim (ativa degradação controlada e gera tráfego)          |
| **Exige chave de acesso** | Não                                             | Depende da configuração do servidor (ou local via Docker) |

## Passo a passo no Modo Replay

1. Clique em **Demonstração** no cabeçalho do War Room.
2. Mantenha a opção **Modo Live** desligada (padrão `REPLAY`).
3. Clique em **Simular Incidente**.
4. O painel fecha automaticamente para você acompanhar o fluxo completo de um incidente real previamente gravado.
5. Ao chegar na etapa **Notificado**, clique em **Simular Aprovação** no Painel de Remediação para encerrar o ciclo.

## Passo a passo no Modo Live

1. Abra o painel **Demonstração** e ative a chave **Modo Live**.
2. Se o servidor exigir autorização para execuções reais, informe a **Chave de Demonstração Live** no campo indicado.
3. Se o ambiente público usar proteção anti-bot **Cloudflare Turnstile**, aguarde ou conclua o desafio exibido na faixa de avisos abaixo do cabeçalho.
4. _(Opcional)_ Ative **Tráfego Saudável Contínuo** para observar métricas normais em tempo real antes de injetar a falha.
5. Clique em **Simular Incidente**: o ZeroMTTR degrada o serviço de exemplo, gera carga sintética controlada, aguarda o alerta real do Grafana, diagnostica, abre um PR no GitHub e envia o e-mail Post-Mortem.
6. Para devolver o serviço ao estado saudável a qualquer momento, abra **Demonstração** e clique em **Restaurar Serviço**.

:::warning Cooldown entre simulações
Para evitar execuções simultâneas ou uso abusivo de cotas, o servidor aplica um período de espera (padrão de **2 minutos**) entre disparos consecutivos. Se o limite for atingido, o aviso exibirá quantos segundos faltam para a próxima tentativa.
:::

:::info Alvos sem suporte a simulação de caos
Quando o ZeroMTTR está conectado a um serviço real de produção (ou monitorado passivamente via Prometheus), o serviço reporta que não suporta simulação de caos. Nesses casos, os botões de injeção de falha e tráfego sintético são ocultados automaticamente para proteger o ambiente.
:::
