# ADR-009: Mascaramento de PII na Borda via Processor `transform` (OTTL) no OTel Collector

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

Logs emitidos por aplicações críticas frequentemente contêm dados pessoais protegidos pela LGPD (CPF, CNPJ, telefone, e-mail, chaves PIX) ou credenciais (`Authorization: Bearer <jwt>`). Mascarar esses dados apenas no momento de chamar o LLM deixaria PII gravada em texto claro no Loki e visível em dashboards operacionais.

## Decisão

Aplicar mascaramento de PII **na borda de ingestão**, diretamente no **OpenTelemetry Collector** (`infra/otel-collector-config.yaml` e `infra/otel-collector-config.prod.yaml`), usando o processor **`transform`** com expressões OTTL `replace_pattern` sobre `body` e atributos de log antes da exportação para o Loki.

Essa barreira primária é complementada na camada de raciocínio pela segunda barreira determinística e _fail-closed_ (**`PiiPromptGuard`**, ADR-004), que bloqueia o envio ao LLM caso algum dos padrões determinísticos suportados (CPF/CNPJ Módulo-11, telefones com DDD segundo regras ANATEL, e-mail RFC 5322, chave PIX EVP em contexto PIX e tokens JWT/Bearer) escape da borda. Formatos fora desse escopo (como telefones sem DDD ou nomes próprios em texto livre) não são detectados por essas regras e podem permanecer sem máscara no Loki e atravessar o guard.

## Consequências

### Positivas

- Dados sensíveis são redigidos (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `[REDACTED_PIX_EMAIL]`, `[REDACTED_PHONE]`, `[REDACTED_PIX_EVP]`, `[REDACTED_JWT]`, `Bearer [REDACTED_TOKEN]`) antes da persistência em disco no Loki.
- Nenhuma aplicação monitorada precisa implementar bibliotecas proprietárias de sanitização para se beneficiar da proteção.

### Trade-offs

- Expressões regulares OTTL no Collector atuam por correspondência sintática e não executam dígito verificador Módulo-11 (essa validação refinada é executada no `PiiPromptGuard`).
- O processor `transform` acrescenta pequena sobrecarga de CPU/RAM no Collector, mitigada com `GOMEMLIMIT=200MiB` e `memory_limiter`.

## Alternativas Descartadas

- **Sanitizar apenas no código da aplicação alvo:** violaria o caráter agnóstico da plataforma e exigiria alterar cada microsserviço monitorado.
- **Sanitizar apenas no `orchestrator`:** deixaria PII persistida sem máscara no Loki.

## Referências no Código

- `infra/otel-collector-config.yaml`
- `infra/otel-collector-config.prod.yaml`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `scripts/smoke-phase1.sh`
