# TECH 06 — Estrategia de pruebas (Integración y E2E primero), Helpers y Calidad (Transversal)

**Aplica a:** todas las fases · **Referencia:** Arquitectura Maestra §6 y §10

## 1. Filosofía de pruebas: *Testing Trophy* (Prioridad de integración y E2E)
Dado que **ZeroMTTR** es una plataforma orientada a eventos que integra múltiples sistemas (Grafana Alerting → Orchestrator HTTP/SSE → MCP Server HTTP → OTel Collector/LGTM → GitHub/Resend/Gemini), el proyecto adopta el modelo **Testing Trophy**:
1. **Prioridad máxima — Pruebas de integración y E2E (`test/integration/` y `scripts/smoke-*.sh`):**
   - Ejercitan el flujo real de la aplicación desde el borde HTTP (`Supertest`), pasando por enrutamiento, autenticación, máquina de estados (FSM), `PiiPromptGuard`, comunicación MCP sobre HTTP y serialización SSE, interceptando únicamente las APIs externas en el límite HTTP saliente (`nock`).
   - Deben cubrir **tanto *Happy Paths* como *Unhappy Paths*** antes de la implementación (TDD de integración), sirviendo como documentación ejecutable del sistema.
2. **Pruebas unitarias solo para funciones puras de apoyo (`test/unit/`):**
   - Reservadas **estrictamente** para algoritmos puros sin E/S: cálculo de dígito de control Módulo-11 (CPF/CNPJ), validadores con expresiones regulares (ANATEL / BACEN EVP / JWT), cálculo lineal de `EvidenceCoverage`, truncamiento/poda de bytes FinOps, transiciones puras de FSM y escape de HTML (`renderPostMortem`).
   - Evita crear decenas de pruebas unitarias acopladas a mocks artificiales para flujos que ya se validan con mucha mayor fidelidad mediante pruebas de integración.

---

## 2. Estructura de carpetas y helpers de prueba obligatorios (`test/helpers/`)
Para evitar repetir comandos HTTP (`supertest(app).post(...).set('Authorization', ...)`), armado de payloads o configuraciones repetitivas de `nock`, cada paquete **debe implementar funciones helper reutilizables en `test/helpers/` antes de escribir las suites de pruebas**:

```text
apps/<package>/test/
  helpers/
    http-test-client.ts     # Helper functions encapsulating Supertest calls and auth headers
    external-apis.helper.ts # Reusable nock builders for LGTM, GitHub, Gemini, and Resend
    fixtures.helper.ts      # Payload factories (Grafana alerts, logs with/without PII, Git diffs)
  integration/              # Top priority: complete HTTP, MCP, SSE, and PII flows (Happy & Unhappy)
  unit/                     # Pure support functions only (Modulo-11, ANATEL/BACEN regexes, FinOps, FSM)
```

### Contrato mínimo para helpers (`test/helpers/http-test-client.ts` y `external-apis.helper.ts`)
- **`postGrafanaAlert(app, overrides?, token = GRAFANA_WEBHOOK_TOKEN)`:** Dispara `POST /webhook/grafana-alert` con cabecera `Bearer` y payload válido por defecto (permitiendo sobrescribir campos o probar token inválido en 1 línea).
- **`getIncident(app, incidentId, token = DASHBOARD_API_TOKEN)`:** Ejecuta `GET /api/incidents/:id` con autenticación del Dashboard.
- **`postEmailHmacDecision(app, incidentId, { action, sig, exp })`:** Ejecuta `POST /api/incidents/:id/decision` simulando el envío del fragmento `#` leído por la SPA.
- **`callMcpTool(app, toolName, args, token = MCP_AUTH_TOKEN)`:** Envuelve el sobre JSON-RPC `tools/call` sobre `POST /mcp`.
- **`collectSseEventsUntil(app, predicateOrState, timeoutMs)`:** Se conecta a `GET /api/events` y recopila los eventos SSE emitidos hasta alcanzar el estado objetivo (p. ej., `NOTIFIED` o `RESOLVED`).
- **`stubObservabilityAndGithub({ lokiLogBody, traceStatus, gitDiffPatch, geminiShouldFail })`:** Configura en una sola llamada todos los interceptores HTTP (`nock`) para Prometheus, Tempo, Loki, GitHub, Gemini y Resend, permitiendo probar cualquier *Happy Path* o *Unhappy Path* cambiando solo el parámetro deseado.

---

## 3. Reglas de desarrollo guiado por pruebas (TDD de integración + apoyo)
1. **Escribir *Happy Paths* y *Unhappy Paths* primero (Red → Green → Refactor):** Antes de implementar una ruta, herramienta MCP o regla de protección de PII, escribir los escenarios de éxito y fallo utilizando los helpers en `test/helpers/`.
2. **Pruebas parametrizadas (`it.each` / `test.each`):** Para reglas de validación y regexes (CPF, CNPJ, ANATEL, BACEN EVP, JWT), usar tablas parametrizadas con entradas válidas (*Happy*) e inválidas/adversariales (*Unhappy*) lado a lado, sirviendo como documentación viva.
3. **Prohibido llamar a APIs externas reales en la suite automatizada (`ci.yml`):** Toda comunicación con Gemini, GitHub, Resend y LGTM en las pruebas de integración con Vitest pasa por los helpers en `external-apis.helper.ts` (`nock`). Las pruebas reales contra contenedores Docker y APIs externas se ejecutan en los scripts smoke/E2E (`scripts/smoke-integrations.sh`).

---

## 4. Matriz obligatoria de *Happy Paths* vs. *Unhappy Paths* (Documentación ejecutable)

### 4.1 Integración y apoyo: Doble barrera de PII (5 tipos de clave PIX BACEN + ANATEL + JWT)
Probado **tanto en el pipeline de integración** (inyectando el log vía `stubObservabilityAndGithub({ lokiLogBody })` y verificando el comportamiento de Orchestrator + `PiiPromptGuard` + llamada o bloqueo de Gemini) **como en la tabla parametrizada (`it.each`) de la función de apoyo**:

| Regla / Patrón | 🟢 Happy Path (Telemetría limpia / Post-Collector → `passed: true`, llama a Gemini, `reasoningSource: 'llm'`) | 🔴 Unhappy Path (Fuga residual / Pre-Collector → `passed: false`, **0 llamadas a Gemini [Fail-Closed]**, `reasoningSource: 'fallback'`) |
| :--- | :--- | :--- |
| **1. CPF (Módulo-11 Receita Federal)** | • Log ya enmascarado `[REDACTED_CPF]`<br/>• `trace_id` OTel de 32 hex (`4bf92f3577b34da6a3ce929d0e0e4736`)<br/>• `commit_sha` de 40 hex<br/>• Float decimal (`4512.11144477735` y `11144477735.99`)<br/>• Secuencia de 11 dígitos con Módulo-11 inválido (`12345678900`) o dígitos repetidos (`11111111111`)<br/>• **Idempotencia de estado:** ejecutar la guardia dos veces seguidas sobre el mismo texto produce exactamente el mismo resultado (`passed: true`), demostrando ausencia del bug de `lastIndex` en regex `/g` | • CPF con puntuación (`123.456.789-00` / `111.444.777-35`)<br/>• CPF aislado sin puntuación (`cpf=11144477735`)<br/>• **CPF al final de frase seguido de un punto (`...falhou para CPF 11144477735.`)**<br/>• **CPF tras guion bajo (`user_11144477735`) o guion (`CPF-11144477735`)**<br/>• **Doble llamada:** dos invocaciones consecutivas que contienen un CPF inválido/filtrado resultan en `passed: false` en ambas |
| **2. CNPJ (Módulo-11 Receita Federal)** | • Log ya enmascarado `[REDACTED_CNPJ]`<br/>• Secuencia de 14 dígitos con Módulo-11 inválido o dígitos repetidos (`11111111111111`) | • CNPJ con puntuación (`12.345.678/0001-99` / `11.222.333/0001-81`)<br/>• CNPJ sin puntuación válido según Módulo-11 (`11222333000181`), incluido al final de una frase con punto |
| **3. Teléfono móvil y fijo (Reglas ANATEL)** | • Log ya enmascarado `[REDACTED_PHONE]`<br/>• **Timestamps Unix de 10 dígitos (`1734567890`) y 13 dígitos (`1734567890123`)**<br/>• Número de 8 dígitos empezado por `6` (`(11) 6456-7890` — inválido para teléfono fijo según ANATEL) | • **Móvil de 9 dígitos (`9XXXX-XXXX`):** `(11) 98765-4321`, `11 98765-4321`<br/>• **Fijo de 8 dígitos (`[2-5]XXX-XXXX`):** `(11) 3456-7890`, `11 3456-7890`<br/>• **PIX internacional E.164 (`+55`):** `+5511987654321`, `+551134567890`<br/>• **Sin enmascarar en campo contextual:** `pix=11987654321`, `"phone":"11987654321"`, `tel: 1134567890` |
| **4. Clave PIX de correo electrónico (RFC 5322)** | • Log ya enmascarado `[REDACTED_PIX_EMAIL]`<br/>• Nombres de paquetes `@modelcontextprotocol/sdk` (sin dominio TLD válido tras `@`) | • Correo en texto plano en log o error de span (`cliente.silva@exemplo.com.br`) |
| **5. Clave PIX aleatoria (EVP / UUID v4 BACEN)** | • Log ya enmascarado `pixKey=[REDACTED_PIX_EVP]`<br/>• **UUID v4 técnico ordinario sin etiqueta PIX (`request_id=123e4567-e89b-42d3-a456-426614174000`, `incident_id=...`)**<br/>• UUID v1 (3.er bloque no empieza por `4`) | • UUID v4 RFC 4122 (`4xxx-[89ab]xxx`) precedido por contexto PIX: `pixKey=123e4567-e89b-42d3-a456-426614174000`, `"chave_pix": "123e4567-e89b-42d3-a456-426614174000"`, `evp: 123e4567-...` |
| **6. Credenciales Bearer y JWT** | • Log ya enmascarado `Bearer [REDACTED_TOKEN]` | • Cabecera `Bearer <token>`<br/>• **JWT sin procesar sin la palabra `Bearer`**, tanto largo como con **payload corto (`eyJhbGciOiJIUzI1NiJ9.e30.sig`)** |

---

### 4.2 Integración HTTP: Flujo de incidentes, MCP, FinOps y gobernanza HMAC
Probado mediante `Supertest` usando los helpers en `test/helpers/http-test-client.ts`:

| Flujo integrado | 🟢 Happy Path | 🔴 Unhappy Path |
| :--- | :--- | :--- |
| **1. Ingesta de alertas (`POST /webhook/grafana-alert`)** | • `GRAFANA_WEBHOOK_TOKEN` válido → `202 Accepted`, crea el incidente e inicia el pipeline asíncrono<br/>• Segunda alerta con el mismo `fingerprint` mientras está abierto → deduplica y devuelve el incidente existente | • Token ausente o uso de `DASHBOARD_API_TOKEN` / `MCP_AUTH_TOKEN` → `401 Unauthorized`<br/>• Payload malformado (falta `alerts` o `service`) → `400 Bad Request` (Zod) |
| **2. Recolección MCP y `EvidenceCoverage` (`POST /mcp`)** | • 4 señales presentes (PromQL + Exemplar `trace_id` + Span de error en Tempo + log de Loki y diff de GitHub `v2.14.7...v2.14.8`) → `EvidenceCoverage = 100% (4/4)`, payload podado (≤ 5 series, ≤ 100 líneas, ≤ 1500 caracteres de diff) y `finops` calculado | • Llamada MCP sin `MCP_AUTH_TOKEN` → `401`<br/>• Ausencia parcial de señales (p. ej., métrica sin exemplar o diff sin commit sospechoso) → degradación lineal a `75% (3/4)` o `50% (2/4)` sin abortar el diagnóstico<br/>• Indisponibilidad total de Gemini API → fallback determinista (`reasoningSource: 'fallback'`) |
| **3. Aislamiento HMAC y decisión humana (`POST /api/incidents/:id/decision`)** | • El enlace del correo usa el fragmento `#action=approve&sig=<HMAC>&exp=<TS>`<br/>• `POST /api/incidents/:id/decision` con `sig` válido y `exp` dentro de 15 min → `200 OK`, transiciona FSM a `RESOLVED` (o `REJECTED`) y anota en Grafana | • `GET /api/incidents/:id` y el stream SSE `incident.notified` **nunca exponen `sig` (`approveSig`/`rejectSig`)**<br/>• Firma `sig` manipulada o de otro `incidentId` → `401 Unauthorized`<br/>• Timestamp `exp` expirado (> 15 min) → `401 Unauthorized`<br/>• **Segundo intento de decisión sobre un incidente ya `RESOLVED` o `REJECTED` → `409 Conflict` (`InvalidTransitionError`)** |
| **4. Escape XSS en Post-Mortem (`renderPostMortem`)** | • El HTML generado contiene Evidence Coverage, Reasoning Source, Blast Radius y enlaces con `#fragment` | • La inyección `<script>alert(1)</script>` en el resumen de RCA o nombre del servicio se escapa (`&lt;script&gt;`) |

---

## 5. Puertas de calidad en CI/CD de GitHub Actions
| Comprobación | Criterio | Workflow |
| :--- | :--- | :--- |
| Suite de integración (Happy + Unhappy Paths) + Funciones de apoyo | 100 % aprobada + Cobertura ≥ 80 % en `domain/` y `application/` (bloqueante) | `ci.yml` |
| ESLint (incluida frontera hexagonal) + Prettier | 0 errores (bloqueante) | `ci.yml` |
| `tsc --noEmit` | 0 errores (bloqueante) | `ci.yml` |
| Secretos filtrados (`gitleaks`) | 0 ocurrencias (bloqueante) | `ci.yml` |
| Auditoría de dependencias (`pnpm audit --prod --audit-level=critical`) | 0 vulnerabilidades `critical` (bloqueante) | `ci.yml` |
| Suite de regresión en PRs autónomos (`hotfix/zeromttr-*`) | 100 % verde + comentario en PR | `hotfix-verify.yml` |
| Build y Push de imágenes (`ghcr.io`) | Éxito en los 4 servicios | `cd-release.yml` |

## 6. Definition of Done (Por fase / Pull Request)
- [ ] Helpers de prueba (`test/helpers/`) creados sin duplicación de código HTTP
- [ ] Pruebas de integración (*Happy Paths* + *Unhappy Paths*) y pruebas de funciones de apoyo escritas primero y en verde
- [ ] `pnpm run check:workspace` 100 % verde
- [ ] Cero secretos, cero PII y cero referencias a artefactos externos no versionados
- [ ] Criterios de aceptación del documento `tech/NN` correspondiente cumplidos
