# ADR-006: Segregação de Tokens de API e Aprovação Humana via HMAC Exclusivo no E-mail

- **Status:** Aceito
- **Data:** 2026-11-01

## Contexto

O ZeroMTTR expõe múltiplos pontos de entrada (servidor MCP, webhook de alertas do Grafana, API/SSE do Dashboard e endpoint de decisão humana). Compartilhar um único segredo entre superfícies ou expor tokens de aprovação no frontend violaria o princípio do menor privilégio e permitiria que visitantes anônimos da demonstração aprovassem ou rejeitassem hotfixes reais.

## Decisão

1. **Segregar estritamente três tokens independentes:**
   - `MCP_AUTH_TOKEN`: autenticação entre clientes/orquestrador e `apps/mcp-server`.
   - `GRAFANA_WEBHOOK_TOKEN`: autenticação do webhook de alertas disparado pelo Grafana.
   - `DASHBOARD_API_TOKEN`: injetado server-side pelo proxy reverso Nginx (`apps/dashboard/nginx.conf.template`) nas chamadas `/api/*`, nunca embutido no bundle JavaScript.
2. **Assinar decisões humanas com HMAC-SHA256** (`DECISION_HMAC_SECRET`) com expiração (`exp`) e vínculo ao `incidentId` e `action` (`approve` | `reject`), utilizando comparação em tempo constante (`crypto.timingSafeEqual`).
3. **Transportar a assinatura exclusivamente no `#fragment` da URL** enviada por e-mail via Resend (`/decision/:id#action=approve&sig=...&exp=...`). O `#fragment` nunca é enviado ao servidor em requisições `GET` nem gravado em logs de acesso; o `DecisionComponent` lê o fragmento no navegador e envia `action`, `sig` e `exp` no corpo de `POST /api/incidents/:id/decision`.
4. **Nunca expor** `sig`, `approveSig` ou `rejectSig` em respostas REST, eventos SSE ou logs estruturados.

## Consequências

### Positivas

- Visitantes anônimos podem acompanhar o War Room em tempo real sem capacidade de forjar aprovação humana.
- Comprometimento de um token de integração não concede acesso às demais superfícies.

### Trade-offs

- Exige que o provedor de e-mail (Resend) mantenha *Click Tracking* desabilitado no domínio de envio para preservar intacto o `#fragment` da URL.

## Alternativas Descartadas

- **Passar `sig` em query string (`?sig=...`):** vazaria a assinatura em logs HTTP de proxy, histórico e cabeçalhos `Referer`.
- **Incluir botão de aprovação direta no War Room sem assinatura por e-mail:** quebraria a governança *human-in-the-loop* em ambientes públicos.

## Referências no Código

- `apps/orchestrator/src/domain/decision-hmac.ts`
- `apps/orchestrator/src/http/auth.ts`
- `apps/orchestrator/src/http/decision.controller.ts`
- `apps/mcp-server/src/transport/auth.ts`
- `apps/dashboard/nginx.conf.template`
