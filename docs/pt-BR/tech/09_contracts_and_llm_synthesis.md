# TECH 09 — Contratos Compartilhados, Síntese por LLM (`ReasoningPort`), Queries e Baseline

**Depende de:** [01](./01_foundation_and_infrastructure.md), [02](./02_mcp_server.md), [05](./05_orchestrator.md) · **Aplicável a:** 2, 4, 4b, 5
**Objetivo:** formalizar o contrato de entrada e saída do LLM (`ReasoningPort`), a especificação do fallback determinístico, os schemas Zod compartilhados em `libs/contracts`, as queries exatas de observabilidade (PromQL, LogQL, TraceQL), as versões fixas de dependências e o schema do snapshot de Replay.

---

## 1. Biblioteca de Contratos Compartilhados (`libs/contracts/`)

Para evitar divergência de tipos e duplicidade de código entre `apps/mcp-server`, `apps/orchestrator` e `apps/dashboard`, os contratos Zod são centralizados na biblioteca compartilhada **`libs/contracts`** (`@zeromttr/contracts`):

```text
libs/contracts/src/
  tools/            # Schemas Zod de entrada (inputSchema) e saída das 8 tools MCP
  llm/              # Schemas de entrada e saída estruturada do ReasoningPort
  incident/         # FSM states, eventos SSE, IncidentDetail e PiiGuardAudit
  index.ts          # Ponto único de exportação
```

### 1.1 Schemas Zod das 8 Tools MCP
```ts
import { z } from 'zod';

// FinOps metadata comum a todas as tools de leitura
export const FinOpsMetricsSchema = z.object({
  rawBytesFetched: z.number().int().nonnegative(),
  compactedBytesSentToLlm: z.number().int().nonnegative(),
  payloadReductionPercent: z.number().min(0).max(100),
  estimatedTokensSaved: z.number().int().nonnegative(),
});

// 1. execute_promql_range
export const ExecutePromqlRangeInputSchema = z.object({
  query: z.string().min(1),
  start: z.string().datetime().or(z.number()),
  end: z.string().datetime().or(z.number()),
  step: z.string().optional().default('15s'),
});
export const ExecutePromqlRangeOutputSchema = z.object({
  seriesCount: z.number().int().max(5),
  summarizedSeries: z.array(z.object({
    metric: z.record(z.string()),
    p50: z.number(),
    p95: z.number(),
    max: z.number(),
    sampleCount: z.number(),
  })),
  exemplarTraceId: z.string().regex(/^[0-9a-f]{32}$/i).optional(),
  finops: FinOpsMetricsSchema,
});

// 2. analyze_otel_trace
export const AnalyzeOtelTraceInputSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/i),
});
export const AnalyzeOtelTraceOutputSchema = z.object({
  traceId: z.string(),
  rootServiceName: z.string(),
  totalDurationMs: z.number(),
  criticalSpans: z.array(z.object({
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    serviceName: z.string(),
    operationName: z.string(),
    durationMs: z.number(),
    hasError: z.boolean(),
    errorMessage: z.string().optional(),
  })).max(5),
  servicesInvolved: z.array(z.string()), // Blast Radius
});

// 3. search_traces_by_traceql (Fallback/exploração quando não há exemplar)
export const SearchTracesByTraceqlInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(5),
});
export const SearchTracesByTraceqlOutputSchema = z.object({
  traces: z.array(z.object({
    traceId: z.string(),
    durationMs: z.number(),
    errorCount: z.number(),
    rootServiceName: z.string(),
  })),
});

// 4. query_loki_logs
export const QueryLokiLogsInputSchema = z.object({
  logql: z.string().min(1),
  start: z.string().datetime().or(z.number()),
  end: z.string().datetime().or(z.number()),
  limit: z.number().int().min(1).max(100).optional().default(50),
});
export const QueryLokiLogsOutputSchema = z.object({
  linesReturned: z.number().int().max(100),
  logs: z.array(z.object({
    timestamp: z.string(),
    stream: z.record(z.string()),
    line: z.string().max(500),
  })),
  finops: FinOpsMetricsSchema,
});

// 5. inspect_git_deploy_diff
export const InspectGitDeployDiffInputSchema = z.object({
  base_ref: z.string().min(1),
  head_ref: z.string().min(1),
  service_path: z.string().optional().default('apps/target-app-demo'),
  suspect_keyword: z.string().optional(),
});
export const InspectGitDeployDiffOutputSchema = z.object({
  suspectCommitSha: z.string(),
  authorLogin: z.string(), // Apenas login, sem e-mail
  commitMessage: z.string(), // Sem linhas Co-authored-by
  suspectFilePath: z.string(),
  currentBlobSha: z.string(),
  truncatedPatch: z.string().max(1500),
  finops: FinOpsMetricsSchema,
});

// 6. create_remediation_pr
export const CreateRemediationPrInputSchema = z.object({
  incident_id: z.string(),
  file_path: z.string(),
  patched_content: z.string().min(1),
  blob_sha: z.string().optional(),
  title: z.string(),
  rca_markdown: z.string(),
  reasoning_source: z.enum(['llm', 'fallback']),
});
export const CreateRemediationPrOutputSchema = z.object({
  branchName: z.string(),
  branchUrl: z.string().url(),
  pullRequestUrl: z.string().url(),
  commitSha: z.string(),
});

// 7. send_post_mortem_resend
export const SendPostMortemResendInputSchema = z.object({
  incidentId: z.string(),
  recipientEmail: z.string().email(),
  htmlBody: z.string().min(1),
});
export const SendPostMortemResendOutputSchema = z.object({
  emailId: z.string(),
  sentAt: z.string(),
});

// 8. annotate_grafana_incident
export const AnnotateGrafanaIncidentInputSchema = z.object({
  time: z.number().int(),
  text: z.string(),
  tags: z.array(z.string()),
  pullRequestUrl: z.string().url().optional(),
});
export const AnnotateGrafanaIncidentOutputSchema = z.object({
  annotationId: z.number().int(),
  success: z.boolean(),
});
```

---

## 2. Contrato da Síntese por LLM (`ReasoningPort`)

O adapter `GeminiReasoningAdapter` consome a API do Google Gemini (`@google/genai`) utilizando estritamente **Structured Outputs** (`responseMimeType: 'application/json'` com `responseSchema`).

### 2.1 System Prompt Canônico
```text
Você é o ZeroMTTR Autonomous SRE Reasoner, um especialista em diagnóstico de causa raiz (RCA) e engenharia de remediação para microsserviços em produção.

Sua missão:
1. Analisar as evidências de telemetria coletadas (Prometheus, Loki, Tempo, Git Diff).
2. Identificar a causa raiz exata da anomalia, correlacionando a degradação de métricas com a regressão introduzida no diff de código.
3. Produzir uma explicação concisa em português brasileiro (pt-BR) para engenheiros de plantão.
4. Gerar o arquivo de código FONTE COMPLETO corrigido (patchedContent), restaurando a estabilidade operacional.

Regras estritas de segurança e código:
- O código corrigido em patchedContent deve conter o arquivo COMPLETO (não use reticências, nem trechos parciais).
- No serviço de pagamentos (payment.repository.ts), garanta impreterivelmente que conexões adquiridas do pool sejam liberadas em um bloco 'finally { client.release(); }' e que o tamanho do pool seja restaurado para safe defaults (max: 10).
- Nunca invente dependências ou altere assinaturas de métodos públicos.
- Responda obrigatoriamente no formato JSON estruturado conforme o schema solicitado.
```

### 2.2 Schema de Entrada (`CollectedEvidence`)
```ts
export interface CollectedEvidence {
  incidentId: string;
  service: string;
  alertName: string;
  promqlSummary: {
    metric: string;
    p95LatencyMs?: number;
    dbPoolWaiting?: number;
  };
  traceAnalysis: {
    traceId: string;
    criticalOperation: string;
    durationMs: number;
    errorMessage?: string;
    servicesInvolved: string[];
  };
  logSample: string; // Já sanitizado pelo Collector ([REDACTED_*])
  gitDiff: {
    baseRef: string;
    headRef: string;
    suspectCommit: string;
    authorLogin: string;
    suspectFilePath: string;
    patch: string;
  };
}
```

### 2.3 Schema de Saída Estruturada do Gemini (`RcaAndPatchSynthesis`)
```ts
export const RcaAndPatchSynthesisSchema = z.object({
  summary: z.string().describe('Resumo executivo do incidente em 1 parágrafo'),
  rootCause: z.string().describe('Explicação técnica detalhada da causa raiz encontrada no código'),
  evidenceRefs: z.array(z.string()).describe('Lista de referências de evidências (ex: trace_id, métrica, commit)'),
  suspectFilePath: z.string().describe('Caminho do arquivo remediado (ex: apps/target-app-demo/src/repositories/payment.repository.ts)'),
  patchedContent: z.string().describe('Conteúdo integral do arquivo corrigido pronto para commit'),
  explanation: z.string().describe('Explicação da alteração realizada no patch e como ela resolve o incidente'),
});

export type RcaAndPatchSynthesis = z.infer<typeof RcaAndPatchSynthesisSchema>;
```

### 2.4 Parâmetros de Execução do LLM
- **Modelo:** `${LLM_MODEL}` (padrão: `gemini-3.5-flash`, com fallback operacional para `gemini-3.5-flash-lite`).
- **Temperature:** `0.1` (baixa variabilidade para garantir previsibilidade e patches determinísticos).
- **MaxOutputTokens:** `4096`.
- **Timeout:** 15.000 ms (15 s), com no máximo 1 retentativa automática com backoff exponencial de 1 s.

### 2.5 Validação Defensiva do Patch Pré-PR
Antes de acionar a tool `create_remediation_pr`, o Orchestrator executa a validação do patch sintetizado:
1. **Allowlist de Arquivo:** `suspectFilePath === 'apps/target-app-demo/src/repositories/payment.repository.ts'`.
2. **Parsing Sintático:** O TypeScript Compiler API (`ts.createSourceFile`) valida se o `patchedContent` é sintaticamente válido.
3. **Asserção de Resolução Operacional:** O código corrigido **deve conter** `client.release()` e `pool` configurado (`max: 10`).
4. **Desvio para Fallback:** Se o JSON for malformado ou qualquer uma das validações falhar, o Orchestrator aborta o uso da síntese do LLM e direciona imediatamente para o `DeterministicFallbackReasoningAdapter` (`reasoningSource: 'fallback'`).

---

## 3. Especificação do Fallback Determinístico (`DeterministicFallbackReasoningAdapter`)

Para garantir que a plataforma nunca falhe ao vivo mesmo em caso de indisponibilidade total do Gemini:
- **Origem do Código Confiável:** O adapter obtém o arquivo `payment.repository.ts` diretamente da versão saudável conhecida (`v2.14.7`) — lendo via GitHub API (`GET /repos/:owner/:repo/contents/apps/target-app-demo/src/repositories/payment.repository.ts?ref=v2.14.7`) ou arquivo local na branch `master`.
- **RCA Determinístico:**
  - `summary`: "Degradação crítica de latência decorrente de saturação do pool de conexões do banco de dados."
  - `rootCause`: "A release v2.14.8 reduziu o pool de conexões para max: 2 e omitiu a liberação de conexões via client.release() em transações que sofrem timeout, provocando KnexTimeoutError."
  - `explanation`: "O patch restaura o bloco 'finally { client.release(); }' e o dimensionamento do pool para max: 10 baseado na versão saudável v2.14.7."
- **Metadados:** Registra explicitamente `reasoningSource: 'fallback'`, badge visível no Dashboard e no corpo do Pull Request.

---

## 4. Queries Concretas da Stack de Observabilidade

### 4.1 Prometheus Alerting Rule (`infra/grafana/provisioning/alerting/rules.yaml`)
Regra acionada quando a latência p95 ultrapassa 2.000 ms ou o pool de conexões entra em espera por mais de 30 s:

```yaml
groups:
  - name: zeromttr-payment-alerts
    rules:
      - alert: PaymentServicePoolExhaustion
        expr: >
          (histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket{service_name="api-pagamentos-core"}[1m])) by (le)) > 2000)
          or
          (db_pool_waiting{service_name="api-pagamentos-core"} > 0)
        for: 30s
        labels:
          service: api-pagamentos-core
          severity: critical
        annotations:
          summary: "Esgotamento de pool e alta latência p95 em api-pagamentos-core"
          description: "Latência p95 acima de 2s e conexões em espera no PostgreSQL."
```

### 4.2 LogQL (Loki)
- **Busca por trace correlacionado:**
  `{service="api-pagamentos-core"} |= "trace_id=" |= "<trace_id>"`
- **Busca por padrão de erro de pool:**
  `{service="api-pagamentos-core"} |= "Pool exhausted" or "KnexTimeoutError"`

### 4.3 Mapeamento de Métricas OpenTelemetry (SDK Node → Prometheus Exporter)
| Métrica no Código (`otel.ts`) | Tipo OTel | Nome Ingerido no Prometheus |
| :--- | :--- | :--- |
| `http_server_duration` | Histogram (ms) | `http_server_duration_milliseconds_bucket`, `_sum`, `_count` (com exemplars contendo `trace_id`) |
| `db_pool_waiting` | UpDownCounter / Gauge | `db_pool_waiting` |
| `db_pool_used` | UpDownCounter / Gauge | `db_pool_used` |

---

## 5. Matriz de Versões Fixas de Dependências

Para garantir reprodutibilidade idêntica entre máquinas e agentes de IA, todas as versões devem ser congeladas via `pnpm-lock.yaml`:

| Pacote / Ferramenta | Versão Exata |
| :--- | :--- |
| **Node.js** | `24.x LTS` (Engine: `>=24.0.0`) |
| **pnpm** | `10.x` |
| **Nx** | `20.3.3` |
| **TypeScript** | `5.7.3` (`ES2024`, `NodeNext`) |
| **@modelcontextprotocol/sdk** | `1.6.0` |
| **@google/genai** | `0.1.2` |
| **Angular** | `19.1.5` |
| **PrimeNG** | `19.0.6` |
| **Tailwind CSS** | `4.0.6` |
| **Express** | `4.21.2` |
| **Knex** | `3.1.0` |
| **pg** | `8.13.1` |
| **Vitest** | `3.0.5` |
| **Zod** | `3.24.1` |
| **Supertest** | `7.0.0` |
| **Nock** | `14.0.0-beta.19` (ou MSW `2.7.0` com suporte nativo a fetch Node 24) |

---

## 6. Schema do Snapshot de Replay (`data/last-recorded-incident.json`)

Quando em modo `replay` na VPS pública, o orquestrador transmite os eventos gravados em `data/last-recorded-incident.json` via SSE com timing acelerado (delay ~3 s entre transições, totalizando ~25 s):

```json
{
  "recordedAt": "2026-11-07T18:00:00.000Z",
  "incidentId": "inc-live-demo-golden",
  "service": "api-pagamentos-core",
  "severity": "critical",
  "evidenceCoverage": {
    "score": 100,
    "signalsCollected": 4,
    "signalsTotal": 4,
    "signals": ["promql_anomaly", "metric_exemplar", "tempo_error_span", "loki_log_diff"]
  },
  "blastRadius": {
    "servicesInvolved": ["api-pagamentos-core", "postgres"]
  },
  "finops": {
    "rawBytesFetched": 48200,
    "compactedBytesSentToLlm": 2890,
    "payloadReductionPercent": 94,
    "estimatedTokensSaved": 11328
  },
  "piiGuardAudit": {
    "leakedPatternsDetected": 0,
    "detectedTypes": [],
    "edgeRedactedTokensVerified": 4,
    "passed": true
  },
  "rca": {
    "summary": "Degradação crítica com p95 > 4.5s causada por saturação do pool de conexões do PostgreSQL.",
    "rootCause": "Commit 8f14e45 em v2.14.8 removeu client.release() no tratamento de timeout e reduziu pool max para 2.",
    "reasoningSource": "llm",
    "suspectFilePath": "apps/target-app-demo/src/repositories/payment.repository.ts"
  },
  "remediation": {
    "branchUrl": "https://github.com/AdmilsonGoncalves/zeromttr/tree/hotfix/zeromttr-demo-golden",
    "pullRequestUrl": "https://github.com/AdmilsonGoncalves/zeromttr/pull/1",
    "commitSha": "8f14e45fceea167a5a36dedd4bea2543d1a2b3c4"
  },
  "eventsTimeline": [
    { "event": "incident.created", "delayMs": 500 },
    { "event": "incident.transition", "state": "INVESTIGATING", "delayMs": 2000 },
    { "event": "incident.transition", "state": "ENRICHING", "delayMs": 3000 },
    { "event": "incident.rca", "delayMs": 4000 },
    { "event": "incident.transition", "state": "REMEDIATING", "delayMs": 2000 },
    { "event": "incident.transition", "state": "AWAITING_PR", "delayMs": 3000 },
    { "event": "incident.remediation", "delayMs": 2000 },
    { "event": "incident.transition", "state": "NOTIFIED", "delayMs": 3000 }
  ]
}
```

### Procedimento de Gravação (`scripts/record-replay.sh`)
Ao final da Fase 5 (ensaio do Live), o script executa uma simulação `live` completa com `LIVE_DEMO_KEY` e captura o stream SSE de `GET /api/events`, salvando o payload consolidado em `data/last-recorded-incident.json` para alimentar a experiência pública da VPS.
