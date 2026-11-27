# TECH 05 — Orquestador (Webhook Segregado + FSM + PiiPromptGuard + Agente) (Fase 4)

**Depende de:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md), [04](./04_partner_integrations.md)
**Objetivo:** recibir la alerta de Grafana y conducir el incidente hasta la apertura de un Pull Request en el repositorio objetivo y el envío del post-mortem mediante Resend — garantizando auditoría cero-PII previa al LLM (`PiiPromptGuard`), segregación de tokens y aislamiento de la firma HMAC exclusivamente dentro del correo electrónico.

## 1. Estructura (`apps/orchestrator/src`)
```text
domain/        incident.ts, incident-state.ts (pure FSM), rca-report.ts, system-settings.ts,
               evidence-coverage.ts, pii-prompt-guard.ts, fingerprint.ts, decision-hmac.ts
ports/         ReasoningPort, IncidentRepository, SettingsRepositoryPort, ToolsPort (MCP client for the 8 tools),
               TargetStatusPort, Clock
application/   HandleAlert, InvestigateIncident, EnrichWithDeployDiff,
               DispatchRemediation, NotifyOnCall, RecordDecision
adapters/      llm.gemini.ts, llm.fallback.ts, mcp.client.ts, repo.file.ts, settings.sqlite.ts,
               logger.console.ts, target-status.http.ts, target-status.prometheus.ts
demo/          demo.controller.ts, demo-session-lifecycle.ts, demo-guards.ts, demo-handlers.ts, replay-runner.ts
http/          app.ts (composición SRP), rate-limit.ts, auth.ts (incl. SETTINGS_ADMIN_TOKEN),
               webhook.controller.ts, api.controller.ts, settings.controller.ts, decision.controller.ts, events.sse.ts
main.ts        composition root
```

## 2. Dominio — FSM, `PiiPromptGuard` (Fail-Closed) y `EvidenceCoverage`
1. **FSM (`incident-state.ts`):**
   - `IncidentState.transition(event)` **puro** y exhaustivamente probado; cualquier transición inválida (incluido el intento de una segunda decisión sobre un incidente ya en `RESOLVED` o `REJECTED`) lanza `InvalidTransitionError`.
   - Cada transición registra `timestamp` (la base para calcular **TTD** y **TTPR**) y `reason`.
   - `fingerprint` de la alerta (etiquetas `alertname+service`) para **deduplicar** incidentes abiertos.
2. **`PiiPromptGuard` Independiente, Fail-Closed y sin Falsos Positivos de Telemetría (`pii-prompt-guard.ts`):**
   - Segunda línea de defensa ejecutada antes de cualquier llamada a `ReasoningPort`, inspeccionando **exclusivamente campos de texto libre** (`logs`, `mensajes de error de spans`, `commits` y `Git diff` — **nunca** arreglos de valores numéricos brutos de series temporales de Prometheus, evitando coincidencias estadísticas de módulo 11 en contadores o duraciones en nanosegundos):
   - **Alcance de inspección e integridad de tokens:** El Servidor MCP realiza el truncado por política estrictamente en límites de línea completa (`truncateLines` para logs y límites de hunk/línea en el diff, evitando que los tokens numéricos de CPF/CNPJ se dividan por la mitad). En el Orquestador, `PiiPromptGuard` audita individualmente cada elemento de evidencia textual recibido de las herramientas MCP y vuelve a auditar el prompt unificado ensamblado antes de cualquier llamada a `ReasoningPort`. Las expresiones regulares siguientes son literales de JavaScript (`/.../`), independientes de las regexes RE2 del Collector, y residen en `pii-prompt-guard.patterns.ts`:
```js
const DDD = '(?:1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[13-579]|8[1-9]|9[1-9])'; // Valid ANATEL area codes (DDD)
export const PII_PATTERNS = {
  cpfDotted:  /(?<![0-9a-zA-Z])\d{3}\.\d{3}\.\d{3}-\d{2}(?![0-9a-zA-Z])/,        // any check digit
  cnpjDotted: /(?<![0-9a-zA-Z])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![0-9a-zA-Z])/,
  digits11:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{11}(?![0-9a-zA-Z])(?!\.\d)/g,           // CPF candidate → validates modulo 11
  digits14:   /(?<![0-9a-zA-Z])(?<!\d\.)\d{14}(?![0-9a-zA-Z])(?!\.\d)/g,           // CNPJ candidate → validates modulo 11
  jwt:        /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/,    // Raw JWT (includes short payload e30)
  bearer:     /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9\-._~+/]{8,}=*/i,                // ignores already-redacted token
  email:      /(?<![A-Za-z0-9._%+-])(?!git@[A-Za-z0-9.-]+:(?:[A-Za-z0-9._~-]+\/[A-Za-z0-9._~/-]+|[A-Za-z0-9._~/-]+\.git(?![A-Za-z0-9._~/-])))[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/,
  phone:      new RegExp(String.raw`(?:\+55\s?${DDD}\s?(?:9\d{8}|[2-5]\d{7})\b|(?:\+?55\s?)?\(${DDD}\)\s?(?:9\d{4}|[2-5]\d{3})-?\d{4}\b|(?:\+?55\s?)?\b${DDD}\s?(?:9\d{4}|[2-5]\d{3})-\d{4}\b|\b(?:pix|tel|cel|fone|phone|whatsapp)\b["':=\s]+(?:\+?55)?${DDD}(?:9\d{8}|[2-5]\d{7})\b)`, 'i'),
  evpPix:     /\b(?:pix(?:_?key)?|chave_?pix|evp)\b["':=\s]+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
};
```
   - **CPF/CNPJ:** El formato con puntos se bloquea independientemente de los dígitos de control; los candidatos `digits11`/`digits14` solo cuentan como fuga si superan el cálculo oficial de **2 dígitos de control (módulo 11)** y no son secuencias de dígitos repetidos (`11111111111`).
   - **Regla Crítica de Implementación en JavaScript (Evitar el bug de `lastIndex` en regexes globales `/g`):** Dado que `digits11` y `digits14` usan el modificador `/g`, **nunca** se debe llamar a `digits11.test(text)` directamente en invocaciones consecutivas (ya que el puntero interno `lastIndex` no se reinicia, provocando que la segunda llamada devuelva `false` para el mismo texto). La implementación del guardián debe iterar mediante `Array.from(text.matchAll(pattern))` o asegurar `pattern.lastIndex = 0` antes y después de la ejecución.
   - **Teléfono (ANATEL):** Móvil `9XXXX-XXXX`, fijo `[2-5]XXX-XXXX`, prefijo regional (DDD) de la lista oficial, con paréntesis/guion, `+55`, o sin enmascarar **únicamente** cuando vaya precedido por una etiqueta contextual (`\b(pix|tel|cel|fone|phone|whatsapp)\b`, evitando `parcel`/`excel`).
   - **Correo electrónico:** Ignora específicamente las URLs SSH de repositorios Git (`git@host:owner/repo` o `git@host:repo.git` mediante lookahead negativo, preservando la detección para correos normales incluso seguidos de dos puntos como `git@empresa.com.br: error`) y el dominio `@users.noreply.github.com` (autores de commits en GitHub). Además, la herramienta `inspect_git_deploy_diff` devuelve únicamente el `login`/nombre del autor y elimina las líneas `Co-authored-by` (véase [tech/02](./02_mcp_server.md)).
   - **EVP (clave PIX aleatoria):** UUID v4 del BACEN (`4xxx-[89ab]xxx`) únicamente cuando va precedido de una etiqueta PIX; los valores ordinarios `request_id`/`incident_id` no lo activan.
   - **Limitación documentada:** Un teléfono fijo sin paréntesis y sin `+55` (p. ej., `12 2000-2024`) puede interpretarse como un número de teléfono (falso positivo raro); el ensayo previo a la grabación cubre este riesgo (`passed: true`).
    - **Cobertura de Contexto de Logs y Prevención de Falsos Positivos:**
      - Los límites de `digits11`/`digits14` garantizan que los CPF al final de una frase seguidos de un punto (`...CPF 11144477735.`), tras un guion bajo (`user_11144477735`) o tras un guion (`CPF-11144477735`) **sean detectados**, mientras que `trace_id` de OTel (32 hex), `span_id` (16 hex), `commit_sha` (40 hex), números decimales (`4512.11144477735` / `11144477735.99`) y timestamps Unix de 10/13 dígitos no provocan falsos positivos.
   - **Comportamiento Fail-Closed (no enmascara silenciosamente):**
     - Devuelve `{ leakedPatternsDetected: number, detectedTypes: string[], edgeRedactedTokensVerified: number, passed: boolean }`.
     - Si `leakedPatternsDetected > 0`, el guardián **NO** enmascara silenciosamente ni finge que fue cero: informa el número exacto de patrones filtrados encontrados, `passed: false`, **aborta el envío al LLM externo (fail-closed)** y activa el adaptador local `DeterministicFallbackReasoningAdapter` (`reasoningSource: 'fallback'`).
3. **`EvidenceCoverage` Lineal (`evidence-coverage.ts`):**
   - Mide de forma determinista y lineal la cobertura de señales independientes recopiladas durante la investigación (`0` a `4` señales, `25%` por señal):
     - Señal 1 (**+25 %**): Anomalía confirmada en la serie PromQL (`execute_promql_range`)
     - Señal 2 (**+25 %**): `trace_id` extraído mediante Exemplar de métrica
     - Señal 3 (**+25 %**): Span crítico con `STATUS_CODE_ERROR` aislado en Grafana Tempo (`analyze_otel_trace`)
     - Señal 4 (**+25 %**, totalizando **100 % — 4/4 señales**): Log de error correlacionado en Loki + commit de regresión aislado en el diff `v2.14.7...v2.14.8` en GitHub (`inspect_git_deploy_diff`).
   - Si no se encuentra alguna señal (p. ej., diff sin commit sospechoso o métrica sin ejemplar), la puntuación desciende proporcionalmente (**75 % — 3/4 señales**, **50 % — 2/4 señales**, **25 % — 1/4 señales**).

## 3. Casos de Uso (Flujo Determinista de Recopilación + Síntesis LLM)
1. **HandleAlert:** Se autentica exclusivamente con `GRAFANA_WEBHOOK_TOKEN`, valida el payload (`zod`), deduplica incidentes abiertos por `fingerprint`, aplica ventanas dinámicas de supresión mediante `SettingsRepositoryPort` + `findLatestByFingerprint` (`rejectionCooldownSeconds` tras rechazo / _Human Takeover_ y `repeatSuppressionSeconds` tras el cierre), crea `Incident(RECEIVED)`, responde `202 Accepted` de inmediato e inicia el procesamiento asíncrono.
2. **InvestigateIncident:**
   - Ejecuta el flujo determinista de recopilación mediante `ToolsPort`:
     `execute_promql_range` → `trace_id` desde ejemplar → `analyze_otel_trace` → `query_loki_logs` (filtrado por `trace_id`), además de consultar `TargetStatusPort` (seleccionado vía `TARGET_STATUS_PROVIDER=manifest|prometheus`: `HttpTargetStatusAdapter` consultando `TARGET_STATUS_PATH:-/ops/status` con fallback `404` hacia `/chaos/status`, o `PrometheusTargetStatusAdapter` consultando Prometheus vía `ToolsPort` MCP) para obtener `version`, `previousHealthyVersion`, `capabilities` y `rawEdgeLogPreCollector` opcional (muestra reportada por la aplicación antes de la exportación OTLP, usada únicamente para comparación visual en el Dashboard y **nunca** incluida en el prompt del LLM).
3. **EnrichWithDeployDiff:** Llama a la herramienta MCP `inspect_git_deploy_diff` comparando las etiquetas reales `v2.14.7` y `v2.14.8` en `apps/target-app-demo`, aislando el commit y el archivo `apps/target-app-demo/src/repositories/payment.repository.ts` (con su `blobSha`).
4. **DispatchRemediation:**
   - Audita el prompt ensamblado con **`PiiPromptGuard.inspectAndEnforceFailClosed`**.
   - Si `passed === true`, sintetiza el RCA y el parche quirúrgico mediante `ReasoningPort` (`GeminiReasoningAdapter` configurable mediante `LLM_MODEL`, por defecto `gemini-3.5-flash`) y registra `reasoningSource: 'llm'`. Si el guardián rechaza (`fail-closed`) o la API del LLM falla, utiliza `DeterministicFallbackReasoningAdapter` y registra explícitamente `reasoningSource: 'fallback'`.
   - Inyecta una anotación en Grafana mediante `annotate_grafana_incident` (`REMEDIATING`), dispara `create_remediation_pr` (dirigido a `release/target-v2.14.8` e incluyendo `reasoningSource` en el cuerpo del PR), recibe `branchUrl`, `pullRequestUrl` y `commitSha`, y solo entonces transiciona a `AWAITING_PR`.
5. **NotifyOnCall (HMAC Exclusivamente en el Fragmento `#` de la URI del Correo):**
   - Calcula `approveSig`, `rejectSig` y `exp` (timestamp Unix en segundos, TTL corto de 15 min / 900 s).
   - Cadena canónica firmada: `canonicalMessage = `${incidentId}:${action}:${exp}`` firmada con HMAC-SHA256 (`DECISION_HMAC_SECRET`).
   - Verificación en tiempo constante (`crypto.timingSafeEqual`) frente a ataques de temporización.
   - Envía el post-mortem mediante la herramienta MCP `send_post_mortem_resend` incluyendo los enlaces firmados en el fragmento de la URL: `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS_SECONDS>`.
   - **Regla de seguridad:** `approveSig` y `rejectSig` **nunca se guardan en el `IncidentDetail` público ni se emiten en el evento SSE `incident.notified`**.
6. **RecordDecision y Hook Post-Aprobación Desacoplado:**
   - En la ruta real `POST /api/incidents/:id/decision`, exige `{ action, sig, exp }` válidos (firmados con `DECISION_HMAC_SECRET`, `exp` no expirado respecto al reloj actual y validado mediante `timingSafeEqual`) y verifica que el incidente siga en `NOTIFIED` (rechazando con `409 Conflict` cualquier intento de segunda decisión sobre un incidente ya en `RESOLVED` o `REJECTED`).
   - `RecordDecision` se mantiene estrictamente agnóstico respecto a `DemoControlPort`, exponiendo solo un callback opcional `onIncidentApproved(incident)` conectado en `main.ts` por la capa `demo/` (`createDemoSessionLifecycle`) cuando `ENABLE_DEMO_MODE !== 'false'`, de modo que la aprobación por correo en modo `live` restaure el servicio demo de forma coherente con `POST /api/demo/simulate-decision`.
   - En `demo.controller.ts`, `POST /api/demo/chaos` (modo live) y `POST /api/demo/healthy-traffic` validan `capabilities.chaosSimulation` y `capabilities.healthyTrafficToggle` (`400 CAPABILITY_NOT_SUPPORTED` cuando son `false`).
   - Para fines de demostración interactiva en pantalla cuando el evaluador está en modo `replay` (o autenticado con `X-Live-Demo-Key`), expone `POST /api/demo/simulate-decision`, claramente separado del endpoint criptográfico de producción.

## 4. Modo "Live API" frente a "Modo Replay Acelerado", Configuración en Runtime y Segregación de Acceso
- Configure `ENABLE_DEMO_MODE=false` para uso real/producción (omite rutas `/api/demo/*` y oculta el drawer de demostración `app-demo-settings` en el War Room, manteniendo siempre disponible `app-system-settings`).
- En el VPS público (`https://zeromttr.agjworks.com`) con `ENABLE_DEMO_MODE=true`, los visitantes anónimos sin cabecera `X-Live-Demo-Key` operan por defecto en modo **`replay`** (que reproduce en ~25 segundos el stream SSE real previamente grabado en `data/last-recorded-incident.json`, sin crear PRs en GitHub ni consumir cuota de correo), salvo que esté habilitado `REQUIRE_DEMO_KEY=false` (o el legado `PUBLIC_LIVE_DEMO=true`) (recomendado con verificación de Cloudflare Turnstile).
- Cuando se dispara en local (`LIVE_DEMO_KEY` vacío), con `REQUIRE_DEMO_KEY=false` (o `PUBLIC_LIVE_DEMO=true`) + Turnstile, o en el VPS con un `X-Live-Demo-Key` válido, ejecuta el verdadero **`modo live` de extremo a extremo**.
- **Cooldown Global (`DEMO_COOLDOWN_MS=120000`):** Evita que clics simultáneos inicien ejecuciones concurrentes.
- **Configuración en Runtime (SQLite Node 24 + `SETTINGS_ADMIN_TOKEN`):** `SqliteSettingsRepository` (`SETTINGS_DB_PATH=/app/var/zeromttr-settings.sqlite`, modo WAL) persiste políticas operativas y `settings_audit_log` atómicamente, con aplicación inmediata en `HandleAlert`, `EnrichWithDeployDiff`, `NotifyOnCall`, `GeminiReasoningAdapter`, `PrometheusTargetStatusAdapter`, `RecordDecision` y `ConsoleJsonLogger.setMinLevel()`. `onCallEmail` siempre se enmascara en `GET /api/settings` y en la auditoría. `PATCH /api/settings` exige `X-Settings-Admin-Token` cuando `SETTINGS_ADMIN_TOKEN` está definido; si no está definido y `ENABLE_DEMO_MODE=true`, opera estrictamente en modo solo lectura (`403 SETTINGS_READ_ONLY`).

## 5. Interfaz HTTP y Segregación de Tokens
| Ruta | Descripción | Autenticación Requerida |
| :--- | :--- | :--- |
| `POST /webhook/grafana-alert` | Recibe webhooks de Grafana Alerting | Bearer `GRAFANA_WEBHOOK_TOKEN` (exclusivo) |
| `GET /api/incidents` / `GET /api/incidents/:id` | Estado y línea temporal (sin `decisionToken`) | Bearer `DASHBOARD_API_TOKEN` (inyectado por Nginx) |
| `POST /api/incidents/:id/decision` | Ejecuta decisión real desde el enlace del correo | Firma HMAC válida (`sig` + `exp` no expirado) |
| `GET /api/settings` | Lee la configuración operativa activa (`onCallEmail` enmascarado), `readonlyInfo`, flags `editable` / `requiresAuthKey` y `auditLog` (sin PII) | Bearer `DASHBOARD_API_TOKEN` |
| `PATCH /api/settings` | Actualiza la configuración en runtime, registra auditoría SQLite y devuelve el snapshot actualizado (`settings`, `readonlyInfo`, `editable`, `requiresAuthKey`, `auditLog`) | Bearer `DASHBOARD_API_TOKEN` + `X-Settings-Admin-Token` (cuando `SETTINGS_ADMIN_TOKEN` está configurado; `403` solo lectura en modo demo sin token) |
| `POST /api/demo/simulate-decision` | Simula decisión en la War Room (etiquetada como simulación) | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` si el incidente es `live` en el VPS) |
| `GET /api/events` | Stream SSE (véase [08 §3.2](./08_dashboard_frontend.md)) | Bearer `DASHBOARD_API_TOKEN` (inyectado por Nginx) |
| `GET /api/target/status` | Estado y capacidades del workload objetivo | Bearer `DASHBOARD_API_TOKEN` |
| `GET /api/demo/config` | Flags en tiempo de ejecución del menú/demo (`demoModeEnabled`, `requireDemoKey`, Turnstile) | Bearer `DASHBOARD_API_TOKEN` |
| `POST /api/demo/chaos` | Dispara simulación `live` o `replay` | Bearer `DASHBOARD_API_TOKEN` (+ Turnstile cuando esté configurado; `X-Live-Demo-Key` para `mode: 'live'` cuando `REQUIRE_DEMO_KEY=true`) |
| `POST /api/demo/reset` | Restaura el servicio y limpia los PRs de demo en el repo objetivo | Bearer `DASHBOARD_API_TOKEN` (+ `X-Live-Demo-Key` si existe una sesión `live` activa) |
| `GET /health` | Comprobación de vitalidad | Pública |

## 6. Criterios de Aceptación
- [ ] `POST /webhook/grafana-alert` rechaza peticiones que usen `DASHBOARD_API_TOKEN` (401/403) y acepta únicamente `GRAFANA_WEBHOOK_TOKEN`.
- [ ] `GET /api/incidents/:id` y el evento SSE `incident.notified` **no contienen** `approveSig` ni `rejectSig`.
- [ ] `PiiPromptGuard` valida los dígitos de control de CPF/CNPJ (módulo 11) y la estructura JWT, operando en modo **fail-closed** (aborta la llamada a `GeminiReasoningAdapter` si `leakedPatternsDetected > 0`).
- [ ] `EvidenceCoverage` devuelve `100% (4/4)` cuando las 4 señales están presentes y se degrada a `75% (3/4)` o `50% (2/4)` cuando se omiten señales en los tests.
- [ ] El evento SSE `incident.rca`, `IncidentDetail` y el PR incluyen `reasoningSource: 'llm' | 'fallback'`.
- [ ] Cobertura ≥ 80 % en `domain/` y `application/`.
