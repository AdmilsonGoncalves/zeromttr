# ADR-010: Desacoplamento do Serviço-Alvo via Manifesto Neutro `/ops/status` e Provider Prometheus

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Na versão inicial do MVP, o orquestrador e o War Room Dashboard consultavam diretamente `/chaos/status` e pressupunham métricas específicas de `api-pagamentos-core` (como `poolActive`, `poolWaiting`, `poolMax`). Isso acoplava o núcleo da plataforma ao workload de demonstração e dificultava monitorar serviços externos ou legados que apenas emitem telemetria OpenTelemetry (OTLP).

## Decisão

1. **Manifesto neutro `GET /ops/status` com `TargetCapabilities` e `TargetSaturation`:** evoluir `@zeromttr/contracts` com `capabilities: { chaosSimulation, healthyTrafficToggle }` e `saturation?: { resourceLabel, active, waiting, max }`, mantendo fallback `404` transparente para `/chaos/status` no `HttpTargetStatusAdapter`.
2. **Provedor passivo via Prometheus (`TARGET_STATUS_PROVIDER=prometheus`):** adicionar `PrometheusTargetStatusAdapter` atrás de `TargetStatusPort` consultando métricas via MCP `ToolsPort`, permitindo monitorar serviços sem nenhum endpoint HTTP customizado.
3. **Hook pós-aprovação desacoplado e roteador de demo em SRP:** `RecordDecision` permanece agnóstico ao `DemoControlPort` expondo apenas `onIncidentApproved`, enquanto `apps/orchestrator/src/demo/` é dividido em `demo-session-lifecycle.ts`, `demo-guards.ts`, `demo-handlers.ts` e `demo.controller.ts`.
4. **Dashboard dirigido por dados e capacidades:** `TargetTelemetryComponent`, gráficos e `DemoSettingsComponent` (`app/shared/demo-settings/`) exibem controles de simulação apenas quando `demoModeEnabled` e `targetCapabilities` permitem.

## Consequências

### Positivas

- Qualquer serviço OTel pode ser monitorado e remediado sem alterar `apps/orchestrator`, `apps/mcp-server` ou `apps/dashboard`.
- Em produção (`ENABLE_DEMO_MODE=false`), todas as rotas `/api/demo/*` e controles de demonstração são omitidos automaticamente.

### Trade-offs

- No modo passivo (`TARGET_STATUS_PROVIDER=prometheus`), não há prévia `rawEdgeLogPreCollector` nem injeção de caos (capacidades retornam `false`), preservando a neutralidade operacional.

## Alternativas Descartadas

- **Manter contrato acoplado a `/chaos/status` e campos de pool PostgreSQL:** violaria a promessa de arquitetura agnóstica de domínio.

## Referências no Código

- `libs/contracts/src/target-status/`
- `apps/target-app-demo/src/routes/ops.routes.ts`
- `apps/target-app-demo/src/controllers/ops-status.controller.ts`
- `apps/orchestrator/src/adapters/target-status.http.ts`
- `apps/orchestrator/src/adapters/target-status.prometheus.ts`
- `apps/orchestrator/src/demo/`
- `apps/dashboard/src/app/shared/demo-settings/`
