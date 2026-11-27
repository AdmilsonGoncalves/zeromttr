# ADR-010: Desacoplamiento del Servicio Objetivo mediante Manifiesto Neutro `/ops/status` y Proveedor Prometheus

- **Estado:** Aceptado
- **Fecha:** 2026-11-26

## Contexto

En el MVP inicial, el orquestador y el War Room Dashboard consultaban directamente `/chaos/status` y asumían campos específicos de `api-pagamentos-core` (`poolActive`, `poolWaiting`, `poolMax`). Esto acoplaba el núcleo de la plataforma a la carga demo y dificultaba monitorizar servicios externos o legados que solo emiten telemetría OpenTelemetry (OTLP).

## Decisión

1. **Manifiesto neutro `GET /ops/status` con `TargetCapabilities` y `TargetSaturation`:** evolucionar `@zeromttr/contracts` con `capabilities: { chaosSimulation, healthyTrafficToggle }` y `saturation?: { resourceLabel, active, waiting, max }`, manteniendo fallback `404` transparente hacia `/chaos/status` en `HttpTargetStatusAdapter`.
2. **Proveedor pasivo mediante Prometheus (`TARGET_STATUS_PROVIDER=prometheus`):** añadir `PrometheusTargetStatusAdapter` detrás de `TargetStatusPort` consultando Prometheus vía MCP `ToolsPort`, permitiendo monitorización sin endpoints personalizados.
3. **Hook post-aprobación desacoplado y enrutador demo en SRP:** `RecordDecision` permanece estrictamente agnóstico de `DemoControlPort` mediante un callback opcional `onIncidentApproved`, mientras `apps/orchestrator/src/demo/` se divide en `demo-session-lifecycle.ts`, `demo-guards.ts`, `demo-handlers.ts` y `demo.controller.ts`.
4. **Dashboard dirigido por datos y capacidades:** `TargetTelemetryComponent`, gráficos y `DemoSettingsComponent` (`app/shared/demo-settings/`) muestran controles de simulación solo cuando `demoModeEnabled` y `targetCapabilities` lo permiten.

## Consecuencias

### Positivas

- Cualquier servicio OTel puede monitorizarse y remediarse sin modificar `apps/orchestrator`, `apps/mcp-server` ni `apps/dashboard`.
- En producción (`ENABLE_DEMO_MODE=false`), todas las rutas `/api/demo/*` y controles de demo se omiten automáticamente.

### Trade-offs

- El modo pasivo `TARGET_STATUS_PROVIDER=prometheus` no proporciona vista previa `rawEdgeLogPreCollector` ni inyección de caos (`capabilities` devuelven `false`), preservando la neutralidad operativa.

## Alternativas Descartadas

- **Mantener `/chaos/status` y campos de pool PostgreSQL hardcodeados:** violaría el principio de arquitectura agnóstica al dominio.

## Referencias en el Código

- `libs/contracts/src/target-status/`
- `apps/target-app-demo/src/routes/ops.routes.ts`
- `apps/target-app-demo/src/controllers/ops-status.controller.ts`
- `apps/orchestrator/src/adapters/target-status.http.ts`
- `apps/orchestrator/src/adapters/target-status.prometheus.ts`
- `apps/orchestrator/src/demo/`
- `apps/dashboard/src/app/shared/demo-settings/`
