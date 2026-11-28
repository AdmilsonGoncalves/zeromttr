---
id: demo-modes
title: Modo Replay vs. Modo Live
slug: /demo-modes
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
4. _(Opcional)_ Ative **Tráfego Saudável Contínuo** para observar métricas normais em tempo real antes de injetar a falha. O switch fica bloqueado enquanto o serviço estiver degradado (restaure antes de reativar) e é desligado automaticamente ao retornar para o Modo Replay.
5. Clique em **Simular Incidente**: o ZeroMTTR degrada o serviço de exemplo, gera carga sintética controlada, aguarda o alerta real do Grafana, diagnostica, abre um PR no GitHub e envia o e-mail Post-Mortem.
6. Para devolver o serviço ao estado saudável a qualquer momento, abra **Demonstração** e clique em **Restaurar Serviço**.

:::warning Cooldown entre simulações e execuções Live consecutivas

- **Cooldown global de disparo (`DEMO_COOLDOWN_MS`, padrão `120000` ms = 2 min):** evita execuções simultâneas ou uso abusivo de cotas. Se ativo, o toast mostra quantos segundos faltam.
- **Supressão de repetição (`REPEAT_SUPPRESSION_SECONDS`) e intervalo do Grafana (`GRAFANA_ALERT_REPEAT_INTERVAL`):** em ambientes de produção/VPS, o padrão é `900s` (15 min) com `AUTO_RESTORE_ON_APPROVE=false`. Restaurar o serviço (e aguardar ~30s para o alerta do Grafana voltar a `OK`) apenas limpa a falha do alvo e permite um novo disparo do Grafana; isso **não** encerra a janela de supressão do incidente anterior. Para executar simulações Live consecutivas sem aguardar 15 minutos, reduza a **Supressão de repetição** em **Configurações ⚙️** **e** restaure o serviço (ou ative **Restaurar alvo ao aprovar**); caso contrário, aguarde o restante da janela. Quando uma supressão ou espera prolongada do Grafana ocorrer, o War Room exibirá um toast de alerta explicando o motivo.
  :::

## Variáveis de ambiente do modo demo

| Variável                                      | Função                                                                              | Padrão                                 |
| :-------------------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------- |
| `ENABLE_DEMO_MODE`                            | Habilita/oculta o menu **Demonstração** e endpoints `/api/demo/*`                   | `true` (Compose) / `false` (prod real) |
| `REQUIRE_DEMO_KEY`                            | Exige o cabeçalho `X-Live-Demo-Key` em ações do Modo Live                           | `false` local / `true` prod            |
| `LIVE_DEMO_KEY`                               | Chave secreta aceita no campo **Chave de Demonstração Live**                        | —                                      |
| `PUBLIC_LIVE_DEMO`                            | Permite Modo Live público sem exigir chave quando `REQUIRE_DEMO_KEY=false`          | `false`                                |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Ativa verificação anti-bot Cloudflare Turnstile em demos públicas                   | vazio (desativado)                     |
| `DEMO_COOLDOWN_MS`                            | Cooldown mínimo entre disparos de `/api/demo/chaos`                                 | `120000` (2 min)                       |
| `CHAOS_ENDPOINTS_ENABLED`                     | Habilita endpoints `/chaos/*` no serviço `target-app-demo`                          | segue `ENABLE_DEMO_MODE`               |
| `CHAOS_AUTO_TRAFFIC_BURST`                    | Gera rajada sintética automática quando caos é ativado no `target-app-demo`         | `true`                                 |
| `HEALTHY_TRAFFIC_AUTO_START`                  | Inicia o tráfego saudável contínuo automaticamente no boot do alvo                  | `false`                                |
| `HEALTHY_TRAFFIC_INTERVAL_MS`                 | Intervalo (ms) entre ondas de tráfego saudável (use `3000`–`5000` para aliviar VPS) | `1500`                                 |

:::info Alvos sem suporte a simulação de caos
Quando o ZeroMTTR está conectado a um serviço real de produção (ou monitorado passivamente via Prometheus), o serviço reporta que não suporta simulação de caos. Nesses casos, os botões de injeção de falha e tráfego sintético são ocultados automaticamente para proteger o ambiente.
:::

:::note Janela anônima ou novo navegador
O tráfego saudável é um estado do servidor, enquanto o modo (Live/Replay) é guardado no navegador. Ao abrir o War Room em um navegador novo (ex.: janela anônima) com o tráfego ainda ativo, o painel alinha o modo para **Live** automaticamente — desde que o Modo Live seja permitido (sem chave exigida ou com chave informada). Se `REQUIRE_DEMO_KEY=true` e nenhuma chave estiver salva, o modo permanece **Replay** e interromper o tráfego ainda exige autorização: mude para **Live** e informe a **Chave de Demonstração Live** antes de desligar o tráfego.
:::
