---
id: connect-service
title: Conectando seu Próprio Serviço
slug: /connect-service
sidebar_position: 6
---

# Conectando seu Próprio Serviço

O núcleo do ZeroMTTR é **agnóstico ao domínio**. Você pode monitorar qualquer aplicação HTTP que emita telemetria OpenTelemetry e tenha código-fonte versionado no GitHub — sem alterar o código do ZeroMTTR.

## Pré-requisitos mínimos da sua aplicação

1. **Telemetria OpenTelemetry (OTLP):** exportar métricas HTTP, traces distribuídos e logs para o OTel Collector da stack.
2. **Repositório no GitHub:** acessível com um token que permita leitura de diffs e criação de branches/Pull Requests.
3. **Regra de alerta no Grafana:** apontando para o webhook do orquestrador quando o serviço ultrapassar seus limites de erro ou latência.

## Escolha o modo de monitoramento de status

### Modo 1 — Passivo via Prometheus (zero mudanças no seu serviço)

Ideal para serviços existentes ou de terceiros onde você não quer adicionar endpoints novos.

Configure no ambiente do **orquestrador**:

```dotenv
TARGET_STATUS_PROVIDER=prometheus
TARGET_SERVICE_NAME=minha-api-pedidos
TARGET_REPO_URL=https://github.com/minha-org/minha-api-pedidos
TARGET_BASE_BRANCH=main
```

Nesse modo:

- O ZeroMTTR sintetiza vazão (req/s), taxa de erro 5xx e latência p95 diretamente a partir das métricas no Prometheus (consultadas via servidor MCP).
- Se nenhuma métrica do serviço for encontrada, o War Room exibe o status **Inacessível**.
- Controles de simulação de caos ficam automaticamente desativados.

### Modo 2 — Cooperativo via Manifesto de Saúde (`GET /ops/status`)

Ideal quando você quer exibir no War Room informações ricas como versão atual, versão anterior saudável e saturação de um recurso específico (ex.: fila de workers, pool de conexões ou threads).

Configure no ambiente do **orquestrador**:

```dotenv
TARGET_STATUS_PROVIDER=manifest
TARGET_APP_URL=http://minha-api-pedidos:8080
TARGET_STATUS_PATH=/ops/status
```

Exemplo de resposta JSON esperada em `GET /ops/status`:

```json
{
  "status": "healthy",
  "service": "minha-api-pedidos",
  "version": "v3.2.0",
  "previousHealthyVersion": "v3.1.9",
  "targetRepo": "https://github.com/minha-org/minha-api-pedidos",
  "suspectFilePath": "src/workers/dispatch.ts",
  "capabilities": {
    "chaosSimulation": false,
    "healthyTrafficToggle": false
  },
  "metrics": {
    "requestsPerSecond": 42.5,
    "errorRate5xxPercent": 0.2,
    "p95LatencyMs": 85,
    "healthyTrafficActive": false,
    "saturation": {
      "resourceLabel": "Worker Queue",
      "active": 4,
      "waiting": 0,
      "max": 20
    }
  }
}
```

:::tip Desativando o modo demonstração em produção
Para ambientes reais, defina `ENABLE_DEMO_MODE=false`. Isso oculta o painel **Demonstração** no War Room e desabilita completamente as rotas de simulação no servidor, mantendo o painel **Configurações** e todo o fluxo de remediação ativos.
:::
