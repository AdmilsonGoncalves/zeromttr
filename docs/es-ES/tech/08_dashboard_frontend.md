# TECH 08 — Panel War Room simplificado (Fase 4b)

**Depende de:** contrato definido en §3 de este documento. Desarrollado contra el servidor mock e integrado con el orquestador ([05](./05_orchestrator.md)) al finalizar.
**Objetivo:** construir una interfaz simplificada de panel único (**Single-Pane "War Room Dashboard"**) enfocada estrictamente en el guion de demostración de 3 minutos, con estética **Dark-First Mission Control** (fondo `slate-950`, bordes `border-slate-800` y tipografía monoespaciada para trazas, logs y diffs).

## 1. Stack simplificado (Foco en la ruta crítica de 3 minutos)

| Elemento | Decisión |
| :--- | :--- |
| Framework | **Angular (última versión estable)** — Standalone Components, Signals, flujo de control `@if/@for`, `--ssr=false` |
| Componentes UI | **PrimeNG** (`primeng`, `@primeuix/themes` preset **Aura Dark**, `primeicons`) |
| Estilos | **Tailwind CSS v4** + `tailwindcss-primeui` (fondo `slate-950`, `border-slate-800`) con breakpoints estándar centralizados en `src/styles/breakpoints.css` (`@theme`) |
| Componentes utilizados | `p-drawer`, `p-toggleswitch`, `p-tag`, `p-button`, `p-tabs`, `p-progressbar`, `p-toast`, `p-tooltip` (inputs/selects nativos, barra FSM horizontal y gráficos SVG temporales con Tailwind y Signals) |
| Controles Compartidos (`app/shared/`) | **`DemoSettingsComponent`** (`<app-demo-settings>`, drawer de Demostración con botón solo icono por debajo de `lg` y oculto cuando `ENABLE_DEMO_MODE=false`), **`SystemSettingsComponent`** (`<app-system-settings>`, icono de engranaje siempre visible abriendo drawer de 4 pestañas: Alertas, Objetivo & Diff, LLM & Ops, Auditoría) y **`LocaleSwitcherComponent`** (`<app-locale-switcher>`, `🇧🇷 PT-BR \| 🇺🇸 EN-US \| 🇪🇸 ES-ES`), alineados a la derecha (`ms-auto`) incluso en una sola columna |
| Internacionalización (i18n) | **Servicio Modular con Signals (`core/i18n/`)**, enum tipado `Language` (`PT_BR`, `EN_US`, `ES_ES`) cubriendo el 100 % de la interfaz, drawers y mensajes de error |
| Servidor Mock | `apps/dashboard/mock-server/` (Node.js puro) emitiendo SSE y REST conforme al contrato de §3 |

## 2. Arquitectura de pantallas: 4 cuadrantes + ruta `/decision/:id`

La ruta principal `/` (`WarRoomComponent`) muestra los 4 cuadrantes alimentados por SSE en tiempo real, mientras que la ruta `/decision/:id` (`DecisionComponent`) gestiona exclusivamente los enlaces firmados con HMAC abiertos desde el correo post-mortem de Resend:

| Cuadrante / Ruta | Contenido en tiempo real |
| :--- | :--- |
| **Q1 — Superior (Cabecera, Flujo FSM, KPIs, FinOps y Drawers Compartidos)** | Estado SSE (`p-tag`), contador **FinOps / Reducción de payload** (`💰 Reducción de Payload: <calculated>%`), controles compartidos alineados a la derecha (`ms-auto` incluso en una sola columna): botón **Demostración** (`<app-demo-settings>`, solo icono por debajo de `lg`, abriendo `p-drawer` con interruptor Live/Replay, campo `X-Live-Demo-Key` en `localStorage`, Tráfico Saludable y acciones Simular/Restaurar condicionadas a `demoModeEnabled` y `targetCapabilities`), botón de engranaje **Configuración** (`<app-system-settings>`, siempre visible, abriendo `p-drawer` compacto con pestañas `Alertas`, `Objetivo & Diff`, `LLM & Ops` y `Auditoría`, con token `X-Settings-Admin-Token` en `sessionStorage`) y `LocaleSwitcherComponent` (`PT-BR / EN-US / ES-ES`); debajo, **barra interactiva horizontal de flujo FSM**, indicadores `TTD` / `TTPR` y **`TargetTelemetryComponent`** *data-driven* (`serviceName` + tarjeta opcional de `saturation.resourceLabel`). |
| **Q2 — Pipeline FSM (Consolidado en la cabecera superior Q1)** | Las etapas del ciclo de vida del incidente (`timelineSteps` / `fsmStages`) se muestran horizontalmente sin desplazamiento en la barra superior de flujo FSM (`Q1`), liberando todo el ancho de pantalla (`lg:col-span-8` + `lg:col-span-4`) para los paneles `Q3` y `Q4`. |
| **Q3 — Centro (Métricas en Vivo + Evidencias OTel + Enmascaramiento PII + Git Diff)** | `p-tabs` con 4 pestañas:<br/>• **Pestaña 1 (Live Metrics):** Gráficos SVG temporales con escala dual (`Latencia p95 y Tasa 5xx`, `Throughput Req/s y Pool DB`)<br/>• **Pestaña 2 (Árbol de trazas, Evidence Coverage, Reasoning Source y Blast Radius):** barra de cobertura **`Evidence Coverage: 4/4 Signals (100%)`** (o `3/4 Signals (75%)` bajo cobertura parcial), insignia dinámica **`Reasoning Source`** que refleja `rca.reasoningSource` (**`Gemini LLM`** cuando es `'llm'` o **`Deterministic Fallback`** cuando es `'fallback'`), etiquetas de **Blast Radius** (`services_involved`) y árbol jerárquico de spans destacando `pg.pool.acquire` (`4.71s ERROR`)<br/>• **Pestaña 3 (Logs de Loki y prueba de enmascaramiento PII):** comparación lado a lado:<br/>&nbsp;&nbsp;🔴 **Log reportado por la aplicación (Pre-Collector):** `...payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99...`<br/>&nbsp;&nbsp;🟢 **Log de Loki / Agente MCP (Post-OTTL `transform`):** `...payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ]...`<br/>&nbsp;&nbsp;+ insignia técnica dinámica que refleja `rca.piiGuardAudit` (**`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`** cuando `passed: true`, o alerta roja **`Fail-Closed Triggered (<N> Leaked Patterns Blocked — Routed to Local Fallback)`** cuando `passed: false`)<br/>• **Pestaña 4 (Git Deploy Diff `v2.14.7...v2.14.8` y FinOps):** diff real extraído de `apps/target-app-demo/src/repositories/payment.repository.ts` y métricas acotadas de reducción FinOps |
| **Q4 — Derecha (GitHub Pull Request + Gobernanza Resend)** | Tarjeta con enlace directo al **Pull Request real abierto en GitHub** (`hotfix/zeromttr-*`), vista previa sanitizada del correo enviado por **Resend**, indicador **`🔒 Awaiting decision via HMAC link dispatched by email to on-call engineer`** y botón secundario etiquetado explícitamente como **`[Simulation Mode] Simulate On-Call Approval`** (`POST /api/demo/simulate-decision`). |
| **Ruta `/decision/:id`** | Página abierta al hacer clic en el botón del correo real enviado por Resend (`/decision/:id#action=approve\|reject&sig=<HMAC>&exp=<TS>`), leyendo los parámetros estrictamente desde `window.location.hash` (sin exponer nunca `sig` en logs o cabeceras de peticiones HTTP), protegiéndose frente a bots de pre-fetch de escáneres de correo (cumplimiento RFC 7231), detectando incidentes ya resueltos/rechazados con banners informativos y confirmando la decisión vía `POST /api/incidents/:id/decision`. |

## 3. Contrato del Orchestrator (Única fuente de verdad)

### 3.1 REST
| Método y ruta | Respuesta / Comportamiento |
| :--- | :--- |
| `GET /api/incidents` | `Incident[]` (resumen, más reciente primero) |
| `GET /api/incidents/:id` | `IncidentDetail` (**nunca** incluye `decisionToken` / `sig`) |
| `GET /api/demo/config` | `{ "demoModeEnabled": boolean, "requireDemoKey": boolean, "publicLiveDemo": boolean, "turnstileSiteKey": string \| null, "turnstileRequired": boolean }` — controla la visibilidad de `app-demo-settings` (`ENABLE_DEMO_MODE`) y el campo de clave (`REQUIRE_DEMO_KEY`) |
| `GET /api/settings` | `{ "settings": SystemSettingsDisplay, "readonlyInfo": SystemSettingsReadonlyInfo, "editable": boolean, "requiresAuthKey": boolean, "auditLog": SettingsAuditEntry[] }` — alimenta el drawer `app-system-settings` (`onCallEmail` siempre enmascarado) y la pestaña Auditoría |
| `PATCH /api/settings` | cuerpo `SystemSettingsPatch` (cabecera opcional `X-Settings-Admin-Token` cuando se exige) → `200` con `SystemSettingsResponse` actualizado (`settings`, `readonlyInfo`, `editable`, `requiresAuthKey`, `auditLog`) |
| `POST /api/demo/chaos` | cuerpo `{ "mode": "live" \| "replay" }` (cabecera opcional `X-Live-Demo-Key`) → `202` |
| `POST /api/demo/reset` | `202` — restaura el servicio objetivo y cierra los PRs de demostración en el repositorio objetivo |
| `GET /api/target/status` | `{ "status": "healthy" \| "degraded" \| "unreachable", "service": string, "version": string, "previousHealthyVersion": string, "capabilities": { "chaosSimulation": boolean, "healthyTrafficToggle": boolean }, "rawEdgeLogPreCollector"?: string, "metrics"?: { "requestsPerSecond": number, "errorRate5xxPercent": number, "p95LatencyMs": number, "healthyTrafficActive": boolean, "saturation"?: { "resourceLabel": string, "active": number, "waiting": number, "max": number } } }` |
| `POST /api/incidents/:id/decision` | cuerpo `{ "action": "approve" \| "reject", "sig": "<HMAC>", "exp": 1730000000 }` → `200` (usado exclusivamente por la ruta `/decision/:id` abierta desde el correo) |
| `POST /api/demo/simulate-decision` | cuerpo `{ "incidentId": string, "action": "approve" \| "reject" }` → `200` (usado por el botón `[Simulation Mode]` en Q4 durante replay/demo) |

### 3.2 SSE — `GET /api/events`
| Evento | Payload |
| :--- | :--- |
| `incident.created` | `{ incidentId, service, severity, mode, at }` |
| `incident.transition` | `{ incidentId, from, to, at, reason? }` |
| `incident.rca` | `{ incidentId, summary, reasoningSource: 'llm' \| 'fallback', evidenceCoveragePercent, signalsCollected, signalsTotal, evidenceBreakdown, blastRadius[], diagnosisSeconds, traceId, criticalSpan, spans[], rawEdgeLogPreCollector?, logSample, piiGuardAudit: { leakedPatternsDetected: number; edgeRedactedTokensVerified: number; passed: boolean }, deployVersion?, mitigations[], grafanaAnnotationId? }` |
| `incident.finops` | `{ incidentId, rawBytesFetched, compactedBytesSent, payloadReductionPercent, estimatedTokensSaved }` |
| `incident.docs` | `{ incidentId, sources: [{ url, title, markdownExcerpt }] }` |
| `incident.remediation` | `{ incidentId, branchUrl, pullRequestUrl?, commitSha? }` |
| `incident.notified` | `{ incidentId, emailId, htmlPreview? }` (**sin** `decisionToken` / `sig`) |
| `incident.decision` | `{ incidentId, action, source: 'email_hmac' \| 'demo_simulation' }` |
| `heartbeat` | `{ at }` cada 15 s |

### 3.3 Tipos TypeScript (`apps/dashboard/src/app/core/contract.ts`)
```ts
export type IncidentState =
  | 'RECEIVED'
  | 'INVESTIGATING'
  | 'ENRICHING'
  | 'REMEDIATING'
  | 'AWAITING_PR'
  | 'NOTIFIED'
  | 'RESOLVED'
  | 'REJECTED'
  | 'FAILED';

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
}

export interface PiiGuardAudit {
  leakedPatternsDetected: number;
  detectedTypes?: string[];
  edgeRedactedTokensVerified: number;
  passed: boolean;
}

export interface Incident {
  id: string;
  service: string;
  severity: AlertSeverity | `${AlertSeverity}`;
  state: IncidentState;
  mode?: 'live' | 'replay';
  startedAt: string;
}

export interface IncidentDetail extends Incident {
  transitions: { from: IncidentState | null; to: IncidentState; at: string; reason?: string }[];
  rca?: {
    summary: string;
    reasoningSource: 'llm' | 'fallback';
    evidenceCoveragePercent: number;
    signalsCollected: number;
    signalsTotal: number;
    evidenceBreakdown?: { promql: number; exemplar: number; tempoSpan: number; lokiAndDiff: number };
    blastRadius: string[];
    diagnosisSeconds: number;
    traceId: string;
    criticalSpan: string;
    spans: SpanNode[];
    rawEdgeLogPreCollector?: string;
    logSample: string;
    piiGuardAudit: PiiGuardAudit;
    deployVersion?: string;
    mitigations: string[];
    grafanaAnnotationId?: number;
  };
  finops?: {
    rawBytesFetched: number;
    compactedBytesSent: number;
    payloadReductionPercent: number;
    estimatedTokensSaved: number;
  };
  docs?: { url: string; title: string; markdownExcerpt: string }[];
  remediation?: { branchUrl: string; pullRequestUrl?: string; commitSha?: string };
  notification?: { emailId: string; htmlPreview?: string };
  decision?: 'approve' | 'reject';
  decisionSource?: 'email_hmac' | 'demo_simulation';
}
```

## 4. Criterios de aceptación
- [ ] `ng build` y `ng test` pasan; ESLint y Prettier sin errores.
- [ ] El selector `LocaleSwitcherComponent` (`🇧🇷 PT-BR | 🇺🇸 EN-US | 🇪🇸 ES-ES`) cambia las etiquetas fijas al instante sin recargar mediante `I18nService`.
- [ ] El modo `Replay` muestra una advertencia clara de que está reproduciendo una ejecución real grabada, mientras que el modo `Live` dispara el pipeline real.
- [ ] La pestaña 1 (`Live Metrics`) muestra gráficos SVG temporales responsivos; la pestaña 2 muestra **`Evidence Coverage: 4/4 Signals (100%)`** y **`Reasoning Source`**; la pestaña 3 muestra la comparación de enmascaramiento OTTL + insignia **`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`**; la pestaña 4 muestra el diff `v2.14.7...v2.14.8` de `apps/target-app-demo` y métricas FinOps.
- [ ] Ningún `decisionToken` ni firma HMAC viaja jamás por SSE ni por `GET /api/incidents/:id`; la ruta `/decision/:id` lee `#action=...&sig=...&exp=...` estrictamente de `window.location.hash` y confirma la decisión vía `POST`.
- [ ] Al abrir `/decision/:id` para un incidente ya cerrado (`RESOLVED` o `REJECTED`), se muestra un banner informativo y se deshabilitan las acciones, evitando falsos errores de token expirado ante HTTP 409 Conflict.
