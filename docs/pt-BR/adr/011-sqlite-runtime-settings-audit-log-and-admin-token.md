# ADR-011: Configurações Operacionais em Runtime via SQLite (Node 24), Trilha de Auditoria e `SETTINGS_ADMIN_TOKEN`

- **Status:** Aceito
- **Data:** 2026-11-26

## Contexto

Políticas operacionais críticas — como cooldown pós-rejeição (_Human Takeover_), janela de supressão de repetição, TTL de links HMAC, refs Git de comparação, modelos LLM e nível de log do orquestrador — exigiam edição manual do `.env` e reinício de contêineres. Além disso, expor alterações administrativas sob a mesma chave usada para visitantes da demonstração (`LIVE_DEMO_KEY`) violaria a segregação de privilégios.

## Decisão

1. **Persistência em SQLite nativo do Node 24 (`node:sqlite` / `DatabaseSync`):** implementar `SqliteSettingsRepository` atrás do port `SettingsRepositoryPort` (`apps/orchestrator/src/ports/settings-repository.port.ts`) em modo WAL, persistindo o documento de configurações e a tabela `settings_audit_log` atomicamente no volume Docker `orchestrator-data:/app/var` (`SETTINGS_DB_PATH=/app/var/zeromttr-settings.sqlite`), sem sobrescrever `/app/data/replay-snapshot.json`.
2. **Aplicação imediata em runtime (zero restart):** `HandleAlert` (cooldown pós-rejeição e supressão de repetição via `findLatestByFingerprint`), `EnrichWithDeployDiff`, `OrchestratorWorkflow`, `NotifyOnCall`, `GeminiReasoningAdapter`, `PrometheusTargetStatusAdapter`, `RecordDecision` (`autoRestoreOnApprove`) e `ConsoleJsonLogger.setMinLevel()` passam a ler as configurações ativas em tempo real.
3. **Credencial administrativa dedicada (`SETTINGS_ADMIN_TOKEN` / `X-Settings-Admin-Token`):**
   - Quando `SETTINGS_ADMIN_TOKEN` está definido, é sempre exigido em `PATCH /api/settings` (comparação em tempo constante via SHA-256), independentemente de `LIVE_DEMO_KEY` ou `REQUIRE_DEMO_KEY`.
   - Quando não definido e `ENABLE_DEMO_MODE=true`, o painel entra em modo estritamente somente leitura (`editable: false`, HTTP `403 SETTINGS_READ_ONLY`).
   - Quando não definido e `ENABLE_DEMO_MODE=false` (ambiente privado atrás de VPN/SSO), edições são permitidas.
4. **Privacidade e UI compartilhada:** `onCallEmail` é sempre mascarado nas respostas de `GET /api/settings` e na tabela `settings_audit_log` (zero vazamento de PII). No Dashboard, `SystemSettingsComponent` (`app/shared/system-settings/`) fica sempre acessível pelo ícone de engrenagem em um drawer com 4 abas (`Alertas`, `Alvo & Diff`, `LLM & Ops`, `Auditoria`) e armazena o token administrativo apenas em `sessionStorage`.

## Consequências

### Positivas

- Zero dependências nativas extras ou contêiner adicional de banco de dados (Node 24 built-in `node:sqlite`).
- Trilha completa de auditoria (`before` / `after`, `actor`, `changedAt`) para toda mudança operacional.
- Separação estrita entre chave de demonstração (`localStorage`) e token administrativo (`sessionStorage`).

### Trade-offs

- Modelo single-instance de escrita local em SQLite (coerente com o escopo de VPS única do projeto); múltiplas réplicas exigiriam migrar o adapter por trás de `SettingsRepositoryPort` para PostgreSQL.

## Alternativas Descartadas

- **Reutilizar `LIVE_DEMO_KEY` para `PATCH /api/settings`:** permitiria que avaliadores da demo alterassem políticas administrativas ou e-mail do plantonista.
- **Montar volume em `/app/data`:** ocultaria o arquivo `data/replay-snapshot.json` empacotado na imagem Docker.

## Referências no Código

- `libs/contracts/src/settings/settings.schema.ts`
- `libs/utils/src/http.utils.ts`
- `apps/orchestrator/src/domain/system-settings.ts`
- `apps/orchestrator/src/ports/settings-repository.port.ts`
- `apps/orchestrator/src/adapters/settings.sqlite.ts`
- `apps/orchestrator/src/http/settings.controller.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/dashboard/src/app/shared/system-settings/`
