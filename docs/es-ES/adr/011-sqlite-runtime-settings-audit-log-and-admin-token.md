# ADR-011: Configuración Operativa en Runtime mediante SQLite (Node 24), Auditoría y `SETTINGS_ADMIN_TOKEN`

- **Estado:** Aceptado
- **Fecha:** 2026-11-26

## Contexto

Políticas operativas críticas — como el cooldown tras rechazo (_Human Takeover_), la ventana de supresión de repetición, el TTL de enlaces HMAC, las refs de diff en Git, los modelos LLM y el nivel de log del orquestador — requerían editar `.env` y reiniciar contenedores. Reutilizar la clave de visitantes demo (`LIVE_DEMO_KEY`) para cambios administrativos también violaría la segregación de privilegios.

## Decisión

1. **SQLite nativo de Node 24 (`node:sqlite` / `DatabaseSync`):** implementar `SqliteSettingsRepository` detrás de `SettingsRepositoryPort` (`apps/orchestrator/src/ports/settings-repository.port.ts`) en modo WAL, persistiendo la configuración activa y `settings_audit_log` de forma atómica en el volumen Docker `orchestrator-data:/app/var` (`SETTINGS_DB_PATH=/app/var/zeromttr-settings.sqlite`), sin ocultar `/app/data/replay-snapshot.json`.
2. **Aplicación inmediata en runtime (sin reinicio):** `HandleAlert` (cooldown tras rechazo y supresión de repetición mediante `findLatestByFingerprint`), `EnrichWithDeployDiff`, `OrchestratorWorkflow`, `NotifyOnCall`, `GeminiReasoningAdapter`, `PrometheusTargetStatusAdapter`, `RecordDecision` (`autoRestoreOnApprove`) y `ConsoleJsonLogger.setMinLevel()` leen la configuración activa en tiempo real.
3. **Credencial administrativa dedicada (`SETTINGS_ADMIN_TOKEN` / `X-Settings-Admin-Token`):**
   - Cuando `SETTINGS_ADMIN_TOKEN` está configurado, siempre se exige en `PATCH /api/settings` (comparación en tiempo constante con SHA-256), independientemente de `LIVE_DEMO_KEY` o `REQUIRE_DEMO_KEY`.
   - Cuando no está configurado y `ENABLE_DEMO_MODE=true`, el panel es estrictamente solo lectura (`editable: false`, HTTP `403 SETTINGS_READ_ONLY`).
   - Cuando no está configurado y `ENABLE_DEMO_MODE=false` (entorno privado tras VPN/SSO), las ediciones están permitidas.
4. **Privacidad y UI compartida:** `onCallEmail` siempre aparece enmascarado en `GET /api/settings` y `settings_audit_log` (cero fugas de PII). En el Dashboard, `SystemSettingsComponent` (`app/shared/system-settings/`) está siempre disponible desde el icono de engranaje en un drawer de 4 pestañas (`Alertas`, `Objetivo & Diff`, `LLM & Ops`, `Auditoría`), guardando el token administrativo exclusivamente en `sessionStorage`.

## Consecuencias

### Positivas

- Cero dependencias nativas adicionales ni contenedores extra de base de datos (`node:sqlite` integrado en Node 24).
- Traza completa de auditoría (`before` / `after`, `actor`, `changedAt`) para cada cambio operativo.
- Separación estricta entre clave demo (`localStorage`) y token administrativo (`sessionStorage`).

### Trade-offs

- Escritura SQLite local single-instance (alineada con la arquitectura de VPS único); despliegues multi-réplica pueden intercambiar el adaptador detrás de `SettingsRepositoryPort` por PostgreSQL.

## Alternativas Descartadas

- **Reutilizar `LIVE_DEMO_KEY` para `PATCH /api/settings`:** permitiría que evaluadores de la demo modificaran políticas administrativas o el correo del ingeniero de guardia.
- **Montar el volumen Docker en `/app/data`:** ocultaría el archivo empaquetado `data/replay-snapshot.json`.

## Referencias en el Código

- `libs/contracts/src/settings/settings.schema.ts`
- `libs/utils/src/http.utils.ts`
- `apps/orchestrator/src/domain/system-settings.ts`
- `apps/orchestrator/src/ports/settings-repository.port.ts`
- `apps/orchestrator/src/adapters/settings.sqlite.ts`
- `apps/orchestrator/src/http/settings.controller.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/dashboard/src/app/shared/system-settings/`
