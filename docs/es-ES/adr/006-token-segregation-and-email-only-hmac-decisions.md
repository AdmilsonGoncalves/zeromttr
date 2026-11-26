# ADR-006: Segregación de tokens de API y aprobación humana HMAC exclusivamente por correo electrónico

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

ZeroMTTR expone múltiples puntos de entrada (servidor MCP, webhook de alertas de Grafana, API/SSE del Dashboard y endpoint de decisión humana). Compartir un único secreto entre superficies o exponer tokens de aprobación en el frontend vulneraría el principio de mínimo privilegio y permitiría que visitantes anónimos de la demostración aprobaran o rechazaran hotfixes reales.

## Decisión

1. **Segregar estrictamente tres tokens independientes:**
   - `MCP_AUTH_TOKEN`: autenticación entre clientes/orquestador y `apps/mcp-server`.
   - `GRAFANA_WEBHOOK_TOKEN`: autenticación para el webhook de alertas disparado por Grafana.
   - `DASHBOARD_API_TOKEN`: inyectado en el lado del servidor por el proxy inverso Nginx (`apps/dashboard/nginx.conf.template`) en las llamadas `/api/*`, nunca incrustado en el bundle de JavaScript.
2. **Firmar las decisiones humanas con HMAC-SHA256** (`DECISION_HMAC_SECRET`) con expiración (`exp`) y vinculación a `incidentId` y `action` (`approve` | `reject`), utilizando comparación en tiempo constante (`crypto.timingSafeEqual`).
3. **Transportar la firma exclusivamente en el `#fragment` de la URL** enviada por correo electrónico a través de Resend (`/decision/:id#action=approve&sig=...&exp=...`). El `#fragment` nunca se envía al servidor en peticiones `GET` ni se registra en los logs de acceso; `DecisionComponent` lee el fragmento en el navegador y envía `action`, `sig` y `exp` en el cuerpo de `POST /api/incidents/:id/decision`.
4. **No exponer nunca** `sig`, `approveSig` ni `rejectSig` en respuestas REST, eventos SSE o logs estructurados. `POST /api/demo/simulate-decision` es estrictamente solo para demostración (no es una ruta de aprobación humana en producción), está protegida por `DASHBOARD_API_TOKEN` y, para incidentes `live`, requiere además `X-Live-Demo-Key` (`LIVE_DEMO_KEY` falla en modo fail-closed con `403 Forbidden` cuando está vacía en `production`, y se omite solo en desarrollo/pruebas locales).

## Consecuencias

### Positivas

- Los visitantes anónimos pueden seguir la War Room en tiempo real sin ninguna capacidad de falsificar la aprobación humana.
- El compromiso de un token de integración no otorga acceso a las demás superficies.

### Compromisos

- Requiere que el proveedor de correo (Resend) mantenga desactivado el *Click Tracking* en el dominio remitente para que el `#fragment` de la URL se conserve intacto.

## Alternativas descartadas

- **Pasar `sig` en una cadena de consulta (`?sig=...`):** filtraría la firma en los logs del proxy HTTP, el historial del navegador y las cabeceras `Referer`.
- **Incluir un botón de aprobación directa en la War Room sin firma por correo:** rompería la gobernanza *human-in-the-loop* en entornos públicos.

## Referencias de código

- `apps/orchestrator/src/domain/decision-hmac.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/orchestrator/src/http/decision.controller.ts`
- `apps/mcp-server/src/transport/auth.ts`
- `apps/dashboard/nginx.conf.template`
