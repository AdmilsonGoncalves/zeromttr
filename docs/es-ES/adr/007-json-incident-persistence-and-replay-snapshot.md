# ADR-007: Persistencia de incidentes en memoria + JSON atómico y snapshot para Replay

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

En el MVP, ZeroMTTR debe ejecutarse cómodamente en un VPS con recursos limitados (<= 2,2 GB de RAM total para toda la pila LGTM + aplicaciones) sin requerir una base de datos relacional dedicada para el orquestador, preservando al mismo tiempo el historial de incidentes entre reinicios y ofreciendo un modo **Replay** determinista para visitantes anónimos.

## Decisión

1. Implementar `FileIncidentRepository` (`apps/orchestrator/src/adapters/repo.file.ts`) tras la interfaz `IncidentRepository` (`incident-repository.port.ts`), manteniendo el estado en memoria para lecturas rápidas y persistiendo en un archivo JSON mediante escrituras atómicas (archivo temporal + `rename`).
2. Soportar de forma nativa un snapshot curado de ejecución real (`data/last-recorded-incident.json`) reproducido por `ReplayRunner` (`apps/orchestrator/src/demo/replay-runner.ts`) para el modo público Replay.

## Consecuencias

### Positivas

- Cero sobrecarga operativa y de memoria por un RDBMS adicional en el MVP.
- Los reinicios del contenedor no corrompen el archivo de estado gracias al reemplazo atómico cuando `INCIDENT_STORE_PATH` está configurado en un volumen persistente.
- El puerto `IncidentRepository` permite migrar a PostgreSQL o SQLite en iteraciones futuras sin modificar el código de dominio ni los casos de uso.

### Compromisos

- En los archivos predeterminados `docker-compose.yml` y `docker-compose.prod.yml`, `INCIDENT_STORE_PATH` no está definido ni montado en un volumen persistente; en esa configuración predeterminada, el historial permanece solo en memoria y se pierde al reiniciar el contenedor. Para conservar el historial entre reinicios, `INCIDENT_STORE_PATH` debe configurarse apuntando a un volumen persistente montado.
- No admite múltiples réplicas concurrentes de `orchestrator` compartiendo el mismo archivo local (modelo de instancia única).

## Alternativas descartadas

- **PostgreSQL dedicado para el orquestador:** aumentaría el consumo de RAM y la complejidad de aprovisionamiento del MVP sin un beneficio proporcional.
- **Almacenamiento solo en memoria:** perdería el historial de incidentes en cada reinicio del contenedor.

## Referencias de código

- `apps/orchestrator/src/ports/incident-repository.port.ts`
- `apps/orchestrator/src/adapters/repo.file.ts`
- `apps/orchestrator/src/demo/replay-runner.ts`
- `scripts/record-replay.sh`
