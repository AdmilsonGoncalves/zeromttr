# ADR-011: Runtime System Settings via Node 24 SQLite, Audit Log & Dedicated `SETTINGS_ADMIN_TOKEN`

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Operational policies — such as post-rejection Human Takeover cooldown, repeat suppression window, HMAC decision TTL, Git diff refs, LLM models, and orchestrator log level — previously required editing `.env` and restarting containers. Reusing the demo visitor key (`LIVE_DEMO_KEY`) to authorize administrative changes would also violate privilege segregation.

## Decision

1. **Node 24 built-in SQLite (`node:sqlite` / `DatabaseSync`):** implement `SqliteSettingsRepository` behind `SettingsRepositoryPort` (`apps/orchestrator/src/ports/settings-repository.port.ts`) in WAL mode, persisting both active settings and `settings_audit_log` atomically on Docker volume `orchestrator-data:/app/var` (`SETTINGS_DB_PATH=/app/var/zeromttr-settings.sqlite`) so `/app/data/replay-snapshot.json` is never shadowed.
2. **Immediate runtime wiring (zero restart):** `HandleAlert` (post-rejection cooldown & repeat suppression via `findLatestByFingerprint`), `EnrichWithDeployDiff`, `OrchestratorWorkflow`, `NotifyOnCall`, `GeminiReasoningAdapter`, `PrometheusTargetStatusAdapter`, `RecordDecision` (`autoRestoreOnApprove`), and `ConsoleJsonLogger.setMinLevel()` read live settings on every execution.
3. **Dedicated admin credential (`SETTINGS_ADMIN_TOKEN` / `X-Settings-Admin-Token`):**
   - When `SETTINGS_ADMIN_TOKEN` is configured, it is always required on `PATCH /api/settings` (constant-time SHA-256 comparison), independent of `LIVE_DEMO_KEY` or `REQUIRE_DEMO_KEY`.
   - When unset and `ENABLE_DEMO_MODE=true`, settings are strictly read-only (`editable: false`, HTTP `403 SETTINGS_READ_ONLY`).
   - When unset and `ENABLE_DEMO_MODE=false` (private deployment behind VPN/SSO), edits are allowed.
4. **Privacy & shared UI:** `onCallEmail` is always masked in `GET /api/settings` responses and `settings_audit_log` (zero PII leak). In the Dashboard, `SystemSettingsComponent` (`app/shared/system-settings/`) is always accessible via the gear icon in a 4-tab drawer (`Alerts`, `Target & Diff`, `LLM & Ops`, `Audit`), keeping the admin token exclusively in `sessionStorage`.

## Consequences

### Positive

- Zero native build dependencies or extra database containers (built-in Node 24 `node:sqlite`).
- Complete change audit trail (`before` / `after`, `actor`, `changedAt`) for every operational mutation.
- Strict separation between demo key (`localStorage`) and administrative token (`sessionStorage`).

### Trade-offs

- Single-instance local SQLite writer (aligned with the single-VPS architecture); multi-replica deployments can swap the adapter behind `SettingsRepositoryPort` for PostgreSQL.

## Rejected Alternatives

- **Reusing `LIVE_DEMO_KEY` for `PATCH /api/settings`:** would let demo evaluators mutate administrative policies or the on-call email address.
- **Mounting the Docker volume at `/app/data`:** would shadow the packaged `data/replay-snapshot.json` file.

## Code References

- `libs/contracts/src/settings/settings.schema.ts`
- `libs/utils/src/http.utils.ts`
- `apps/orchestrator/src/domain/system-settings.ts`
- `apps/orchestrator/src/ports/settings-repository.port.ts`
- `apps/orchestrator/src/adapters/settings.sqlite.ts`
- `apps/orchestrator/src/http/settings.controller.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/dashboard/src/app/shared/system-settings/`
