# TECH 04 — Integraciones Externas: API REST de GitHub (Repo Objetivo) y Resend (HMAC Exclusivo)

**Depende de:** [02](./02_mcp_server.md), [03](./03_target_app_demo.md) · **Consumido por:** [05](./05_orchestrator.md)
**Objetivo:** implementar adaptadores HTTP rápidos, idempotentes y aislados por puertos para la inspección real de diffs entre versiones (`RepoInspectorPort`), la creación autónoma de Pull Requests en el repositorio objetivo (`RemediationPort`) y la notificación por correo electrónico con enlaces HMAC exclusivos (`NotifierPort`).

## 1. Puertos (`apps/mcp-server/src/ports/`)
```ts
interface RepoInspectorPort {
  inspectDeployDiff(req: DeployDiffRequest): Promise<DeployDiffBundle>;
}

interface RemediationPort {
  createPullRequest(req: RemediationPrRequest): Promise<RemediationPrReceipt>;
}

interface NotifierPort {
  sendPostMortem(r: PostMortem): Promise<NotificationReceipt>;
}
```
Donde `RemediationPrReceipt` devuelve `{ branchName: string; branchUrl: string; pullRequestUrl: string; commitSha: string }`.

## 2. Inspector de Despliegue y Código en GitHub (`RepoInspectorPort` — `inspect_git_deploy_diff`)
- **Objetivo:** comparar las etiquetas reales `v2.14.7` (saludable) y `v2.14.8` (degradada) en el repositorio `TARGET_GITHUB_REPO` (`https://github.com/AdmilsonGoncalves/zeromttr`, carpeta `apps/target-app-demo`) y recuperar el contenido y el `sha` del archivo sospechoso (`apps/target-app-demo/src/repositories/payment.repository.ts`).
- **Comportamiento de la API de GitHub:**
  1. Consulta `GET /repos/{owner}/{repo}/compare/{base_ref}...{head_ref}` (`v2.14.7...v2.14.8`).
  2. Filtra los archivos modificados dentro de `service_path` (`apps/target-app-demo`) y extrae el commit del autor del cambio, el mensaje del commit y el *patch* (truncado a ≤ 1500 caracteres por archivo).
  3. Consulta `GET /repos/{owner}/{repo}/contents/{filePath}?ref={head_ref}` para obtener el contenido completo codificado en Base64 y el **`sha` del blob actual** (necesario para el paso de remediación).
  4. Calcula la telemetría **FinOps** (`raw_bytes_fetched` del payload sin procesar de la API de GitHub frente a `compacted_bytes_sent_to_llm` tras filtrar únicamente los hunks relevantes).

## 3. Remediación Autónoma mediante PR en GitHub (`RemediationPort` — `create_remediation_pr`)
- **Objetivo:** abrir un Pull Request real, comprobable y determinista en **2 a 5 segundos** en el repositorio `AdmilsonGoncalves/zeromttr` (dirigido a `TARGET_BASE_BRANCH`, por defecto `release/target-v2.14.8`) utilizando `GITHUB_TOKEN`.
- **Flujo de la API de GitHub:**
  1. Obtiene el SHA de la punta de la rama base (`release/target-v2.14.8`) mediante `GET /repos/{owner}/{repo}/git/ref/heads/{baseBranch}`.
  2. Crea (o reutiliza, garantizando **idempotencia por `incident_id`**) la rama `refs/heads/hotfix/zeromttr-<incident_id>` (`POST /repos/{owner}/{repo}/git/refs`).
  3. Obtiene el `sha` actual del blob del archivo en la rama (`GET /repos/{owner}/{repo}/contents/{filePath}?ref=hotfix/zeromttr-<incident_id>`) y escribe el archivo corregido (`PUT /repos/{owner}/{repo}/contents/{filePath}` pasando `content` en Base64, el `sha` del blob y `branch`) con un mensaje de commit estructurado (`fix(target-app-demo): release db client in finally block and restore pool size [incident <id>]`).
  4. Abre el Pull Request (`POST /repos/{owner}/{repo}/pulls` con `base: 'release/target-v2.14.8'`) que incluye título, resumen del RCA, tabla de evidencias OTel, diff de regresión `v2.14.7...v2.14.8`, auditoría cero-PII y lista de verificación de gobernanza; **nunca realiza una fusión automática**.
- **Validación CI Automatizada:** la apertura del PR activa `.github/workflows/hotfix-verify.yml`, que ejecuta el test de regresión de `@zeromttr/target-app-demo` y comenta la insignia `✅ ZeroMTTR Autonomous CI Gate: PASSED` en el PR.

## 4. Resend (`NotifierPort` — `send_post_mortem_resend`) con HMAC Exclusivo en el Fragmento de URI (`#`)
- Plantilla HTML como función pura (`renderPostMortem`), con **escapado HTML** en todos los campos dinámicos, mostrando:
  - **Evidence Coverage Score** (`4/4 Signals — 100%`),
  - **Reasoning Source** (`llm` frente a `fallback`),
  - **Blast Radius** (`services_involved`),
  - **Auditoría Pre-LLM (`PiiPromptGuard`)** (`leakedPatternsDetected: 0`),
  - Commit causante de la regresión (`v2.14.7...v2.14.8`),
  - Botón para revisar el Pull Request en GitHub (`AdmilsonGoncalves/zeromttr`),
  - Botones de decisión humana (**Approve Hotfix** / **Reject Hotfix**) con enlaces firmados mediante HMAC-SHA256 en el **Fragmento de URI (`#`)** y un TTL corto (15 min):
    `${PUBLIC_DASHBOARD_URL}/decision/${id}#action=approve|reject&sig=<HMAC>&exp=<TS>`.
- **Por qué usar el Fragmento de URI (`#`) en lugar de Query String (`?`) y Configuración de Dominio en Resend:**
  - Los navegadores **nunca envían la porción `#fragment` de una URL en las peticiones HTTP GET** al servidor; por lo tanto, la firma `sig` **nunca aparece en los logs de acceso de Cloudflare, Traefik o Nginx**.
  - La ruta `/decision/:id` de la SPA en Angular lee `window.location.hash` localmente en el navegador y envía `{ action, sig, exp }` exclusivamente en el cuerpo de la petición `POST /api/incidents/:id/decision`.
  - **Preservación de `#fragment` en Resend:** mantener **Click Tracking deshabilitado** en la configuración del dominio `zeromttr.agjworks.com` dentro del panel de Resend para garantizar que el enlace `https://zeromttr.agjworks.com/decision/:id#action=...` llegue al cliente de correo sin reescritura intermedia de URLs.
- **Aislamiento de Seguridad de las Firmas HMAC:**
  - Las firmas `approveSig` y `rejectSig` se envían **exclusivamente dentro del correo electrónico entregado por Resend** al destinatario `ON_CALL_ENGINEER_EMAIL`.
  - **Nunca** se devuelven en `GET /api/incidents/:id` ni se emiten en el stream SSE (`incident.notified`).
- Idempotencia mediante la cabecera `Idempotency-Key: post-mortem-<incident_id>` en la llamada a la API de Resend.

## 5. Tests (TDD — Integración mediante `test/helpers/` + Funciones Puras de Soporte)
| Objetivo | Tipo | Escenarios (Happy & Unhappy Paths usando `test/helpers/`) |
| :--- | :--- | :--- |
| `formatPrDescription` y `renderPostMortem` | unitario (soporte puro) | Happy: incluye RCA, métricas, `trace_id`, Evidence Coverage, Blast Radius y enlaces `#fragment`; Unhappy: escapa `<script>` (XSS) y aplica límites |
| `verifyDecisionHmac` | unitario (soporte puro) | Happy: firma válida dentro del TTL de 15 min; Unhappy: firma alterada, `incidentId` no coincidente o `exp` expirado |
| `inspect_git_deploy_diff` (`GithubInspectorHttpAdapter`) | integración HTTP (`callMcpTool` + `nock`) | Happy: tiene éxito comparando `v2.14.7...v2.14.8`, extrae `blobSha`, trunca ≤ 1500 caracteres y calcula FinOps; Unhappy: etiqueta inexistente / error 404 o 500 de la API de GitHub |
| `create_remediation_pr` (`GithubRemediationHttpAdapter`) | integración HTTP (`callMcpTool` + `nock`) | Happy: crea rama + commit con `sha` + PR e idempotencia cuando la rama/PR ya existe; Unhappy: conflicto 409/422 o fallo 5xx |
| `send_post_mortem_resend` (`ResendHttpAdapter`) | integración HTTP (`callMcpTool` + `nock`) | Happy: tiene éxito con cabecera `Idempotency-Key` y enlaces `#fragment`; Unhappy: error 4xx/5xx de la API de Resend |

## 6. Criterios de Aceptación
- [ ] Ningún test automatizado llama a APIs externas reales.
- [ ] El smoke test manual (`scripts/smoke-integrations.sh`) valida la llamada real a `LLM_MODEL` (`gemini-3.5-flash`), `inspect_git_deploy_diff`, `create_remediation_pr` en `AdmilsonGoncalves/zeromttr` y la entrega de correo en Resend.
- [ ] El correo llega con enlaces HMAC funcionales, mientras que el payload SSE `incident.notified` no expone `sig`.
