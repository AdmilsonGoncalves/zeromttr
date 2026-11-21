# ADR-004: Isolamento de LLM atrás de `ReasoningPort`, `PiiPromptGuard` (Fail-Closed) e Fallback Determinístico

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

Modelos de linguagem externos introduzem três riscos operacionais em incidentes críticos: (1) vazamento acidental de dados sensíveis (PII/LGPD ou segredos) no prompt, (2) indisponibilidade, latência ou exaustão de cota da API do provedor e (3) respostas fora do formato estruturado esperado.

## Decisão

1. Isolar o provedor de IA atrás da interface **`ReasoningPort`** (`apps/orchestrator/src/ports/reasoning.port.ts`), implementada em produção por `GeminiReasoningAdapter` (`apps/orchestrator/src/adapters/llm.gemini.ts`).
2. Executar obrigatoriamente o **`PiiPromptGuard`** em modo **fail-closed** antes de qualquer despacho ao LLM. Caso qualquer padrão residual de CPF/CNPJ (validado por Módulo-11), telefone (regras ANATEL), e-mail no formato padrão sem aspas (`[A-Za-z0-9._%+-]+@domínio`, não cobrindo *quoted local parts* da RFC 5322 como endereços com espaços), chave PIX EVP (UUID v4 em contexto PIX) ou token JWT/Bearer seja encontrado, o envio ao LLM é abortado imediatamente.
3. Fornecer o **`FallbackReasoningAdapter`** (`apps/orchestrator/src/adapters/llm.fallback.ts`) para manter o diagnóstico determinístico operacional caso o LLM falhe, dê timeout ou não possua credencial configurada, registrando transparentemente `reasoningSource: 'llm' | 'fallback'` no incidente, SSE e PR.

## Consequências

### Positivas

- Garante defesa em profundidade para LGPD mesmo se uma mensagem escapar da sanitização na borda.
- Elimina ponto único de falha na API externa de IA sem mascarar a origem do raciocínio (`reasoningSource`).

### Trade-offs

- O modo fallback produz diagnósticos estruturados mais genéricos quando não há LLM disponível.
- Nomes próprios em texto livre ou identificadores técnicos não previstos nas regras determinísticas (ex.: `request_id`) estão fora do escopo do `PiiPromptGuard`.

## Alternativas Descartadas

- **Chamar SDK do Gemini diretamente no workflow sem guard:** criaria risco de vazamento de PII e acoplamento rígido ao provedor.
- **Abortar o incidente em erro de LLM sem fallback:** reduziria a resiliência operacional durante indisponibilidades da API externa.

## Referências no Código

- `apps/orchestrator/src/ports/reasoning.port.ts`
- `apps/orchestrator/src/adapters/llm.gemini.ts`
- `apps/orchestrator/src/adapters/llm.fallback.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.ts`
- `apps/orchestrator/src/domain/pii-prompt-guard.patterns.ts`
