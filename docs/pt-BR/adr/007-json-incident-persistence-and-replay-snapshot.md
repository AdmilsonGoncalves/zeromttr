# ADR-007: Persistência de Incidentes em Memória + JSON Atômico e Snapshot de Replay

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

No MVP, o ZeroMTTR precisa rodar confortavelmente em uma VPS de recursos enxutos (<= 2.2 GB de RAM total para toda a pilha LGTM + aplicações) sem exigir um banco de dados relacional dedicado para o orquestrador, mas preservando o histórico de incidentes entre reinícios e oferecendo um modo **Replay** determinístico para visitantes anônimos.

## Decisão

1. Implementar `FileIncidentRepository` (`apps/orchestrator/src/adapters/repo.file.ts`) atrás da interface `IncidentRepository` (`incident-repository.port.ts`), mantendo estado em memória para leitura rápida e persistência em arquivo JSON com escrita atômica (arquivo temporário + `rename`).
2. Suportar nativamente um snapshot curado de execução real (`data/last-recorded-incident.json`) reproduzido pelo `ReplayRunner` (`apps/orchestrator/src/demo/replay-runner.ts`) para o modo Replay público.

## Consequências

### Positivas

- Zero sobrecarga operacional e de memória de um SGBD extra no MVP.
- Reinícios do contêiner não corrompem o arquivo de estado graças à substituição atômica quando `INCIDENT_STORE_PATH` está configurado em um volume persistente.
- O port `IncidentRepository` permite migrar para PostgreSQL ou SQLite em evoluções futuras sem alterar o domínio ou casos de uso.

### Trade-offs

- Nos arquivos `docker-compose.yml` e `docker-compose.prod.yml` padrão, `INCIDENT_STORE_PATH` não é definido nem montado em volume persistente; nessa configuração padrão o histórico fica apenas em memória e é perdido ao reiniciar o contêiner. Para preservar o histórico entre reinícios, é necessário definir `INCIDENT_STORE_PATH` apontando para um volume persistente montado.
- Não suporta múltiplas réplicas simultâneas do `orchestrator` compartilhando o mesmo arquivo local (modelo single-instance).

## Alternativas Descartadas

- **PostgreSQL dedicado para o orquestrador:** elevaria o consumo de RAM e a complexidade de provisionamento do MVP sem ganho proporcional.
- **Armazenamento apenas em memória:** perderia o histórico de incidentes a cada reinício do contêiner.

## Referências no Código

- `apps/orchestrator/src/ports/incident-repository.port.ts`
- `apps/orchestrator/src/adapters/repo.file.ts`
- `apps/orchestrator/src/demo/replay-runner.ts`
- `scripts/record-replay.sh`
