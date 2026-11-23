# ADR-007: In-Memory + Atomic JSON Incident Persistence and Replay Snapshot

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

In the MVP, ZeroMTTR must run comfortably on a resource-constrained VPS (<= 2.2 GB total RAM for the entire LGTM stack + applications) without requiring a dedicated relational database for the orchestrator, while preserving incident history across restarts and offering a deterministic **Replay** mode for anonymous visitors.

## Decision

1. Implement `FileIncidentRepository` (`apps/orchestrator/src/adapters/repo.file.ts`) behind the `IncidentRepository` interface (`incident-repository.port.ts`), keeping state in memory for fast reads and persisting to a JSON file using atomic writes (temporary file + `rename`).
2. Natively support a curated real-execution snapshot (`data/last-recorded-incident.json`) replayed by `ReplayRunner` (`apps/orchestrator/src/demo/replay-runner.ts`) for the public Replay mode.

## Consequences

### Positive

- Zero operational and memory overhead from an extra RDBMS in the MVP.
- Container restarts do not corrupt the state file thanks to atomic replacement when `INCIDENT_STORE_PATH` is configured on a persistent volume.
- The `IncidentRepository` port enables migrating to PostgreSQL or SQLite in future iterations without changing domain or use-case code.

### Trade-offs

- In the default `docker-compose.yml` and `docker-compose.prod.yml` files, `INCIDENT_STORE_PATH` is neither set nor mounted on a persistent volume; in that default configuration, history stays in memory only and is lost on container restart. To preserve history across restarts, `INCIDENT_STORE_PATH` must be set to point to a mounted persistent volume.
- Does not support multiple concurrent `orchestrator` replicas sharing the same local file (single-instance model).

## Rejected Alternatives

- **Dedicated PostgreSQL for the orchestrator:** would increase RAM consumption and MVP provisioning complexity without proportional gain.
- **In-memory-only storage:** would lose incident history on every container restart.

## Code References

- `apps/orchestrator/src/ports/incident-repository.port.ts`
- `apps/orchestrator/src/adapters/repo.file.ts`
- `apps/orchestrator/src/demo/replay-runner.ts`
- `scripts/record-replay.sh`
