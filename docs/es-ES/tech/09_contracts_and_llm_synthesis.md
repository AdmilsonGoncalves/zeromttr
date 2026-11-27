# TECH 09 — Contratos compartidos, síntesis LLM (`ReasoningPort`), consultas y baseline

**Depende de:** [01](./01_foundation_and_infrastructure.md), [02](./02_mcp_server.md), [05](./05_orchestrator.md) · **Aplica a:** 2, 4, 4b, 5
**Objetivo:** Formalizar el contrato de entrada y salida del LLM (`ReasoningPort`), la especificación de fallback determinista, los esquemas Zod compartidos en `libs/contracts`, las consultas exactas de observabilidad (PromQL, LogQL, TraceQL), las versiones fijadas de dependencias y el esquema de la instantánea de Replay.

---

## 1. Biblioteca de contratos compartidos (`libs/contracts/`)

Para evitar divergencias de tipos y duplicación de código entre `apps/mcp-server`, `apps/orchestrator` y `apps/dashboard`, los contratos Zod se centralizan en la biblioteca compartida **`libs/contracts`** (`@zeromttr/contracts`):

```text
libs/contracts/src/
  tools/            # Zod input (inputSchema) and output schemas for the 8 MCP tools
  llm/              # Structured input and output schemas for ReasoningPort
  incident/         # FSM states, SSE events, IncidentDetail, and PiiGuardAudit
  index.ts          # Single export entrypoint
```

### 1.1 Esquemas Zod para las 8 herramientas MCP
```ts
import { z } from 'zod';

// Common FinOps metadata across all read tools
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

// 3. search_traces_by_traceql (Fallback/exploration when no exemplar is available)
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
  authorLogin: z.string(), // Login only, without email
  commitMessage: z.string(), // Without Co-authored-by lines
  suspectFilePath: z.string(),
  currentBlobSha: z.string(),
  truncatedPatch: z.string().max(1500),
  suspectFileContent: z.string().optional(),
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

### 1.2 Contrato Neutro de Estado del Workload Objetivo (`incident/incident.schema.ts`)
```ts
export const TargetCapabilitiesSchema = z.object({
  chaosSimulation: z.boolean().default(false),
  healthyTrafficToggle: z.boolean().default(false)
});

export const TargetSaturationSchema = z.object({
  resourceLabel: z.string().min(1),
  active: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  max: z.number().int().nonnegative()
});

export const TargetLiveMetricsSchema = z.object({
  requestsPerSecond: z.number().nonnegative(),
  errorRate5xxPercent: z.number().min(0).max(100),
  p95LatencyMs: z.number().nonnegative(),
  healthyTrafficActive: z.boolean().default(false),
  saturation: TargetSaturationSchema.optional(),
  poolActive: z.number().int().nonnegative().optional(),
  poolWaiting: z.number().int().nonnegative().optional(),
  poolMax: z.number().int().nonnegative().optional()
});

export const TargetStatusResponseSchema = z.object({
  status: TargetHealthStatusSchema,
  service: z.string(),
  version: z.string(),
  previousHealthyVersion: z.string(),
  targetRepo: z.string().optional(),
  suspectFilePath: z.string().optional(),
  capabilities: TargetCapabilitiesSchema.default({
    chaosSimulation: false,
    healthyTrafficToggle: false
  }),
  rawEdgeLogPreCollector: z.string().optional(),
  metrics: TargetLiveMetricsSchema.optional()
});
```

---

## 2. Contrato de síntesis LLM (`ReasoningPort`)

El `GeminiReasoningAdapter` consume la API de Google Gemini (`@google/genai`) utilizando estrictamente **Structured Outputs** (`responseMimeType: 'application/json'` con `responseSchema`).

### 2.1 System Prompt canónico
```text
You are the ZeroMTTR Autonomous SRE Reasoner, a specialist in root cause analysis (RCA) and remediation engineering for production microservices.

Your mission:
1. Analyze the collected telemetry evidence (Prometheus, Loki, Tempo, Git Diff).
2. Identify the exact root cause of the anomaly, correlating metric degradation with the regression introduced in the code diff.
3. Produce a concise explanation in Brazilian Portuguese (pt-BR) for on-call engineers.
4. Generate the COMPLETE fixed source code file (patchedContent), restoring operational stability.

Strict security and code rules:
- The fixed code in patchedContent must contain the COMPLETE file (do not use ellipses or partial snippets).
- In the payments service (payment.repository.ts), strictly ensure that connections acquired from the pool are released in a 'finally { client.release(); }' block and that the pool size is restored to safe defaults (max: 10).
- Never invent dependencies or alter public method signatures.
- You must respond strictly in structured JSON format matching the requested schema.
```

### 2.2 Esquema de entrada (`CollectedEvidence`)
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
  logSample: string; // Already sanitized by the Collector ([REDACTED_*])
  gitDiff: {
    baseRef: string;
    headRef: string;
    suspectCommit: string;
    authorLogin: string;
    suspectFilePath: string;
    patch: string;
    suspectFileContent?: string;
  };
}
```

### 2.3 Esquema de salida estructurada de Gemini (`RcaAndPatchSynthesis`)
```ts
export const RcaAndPatchSynthesisSchema = z
  .object({
    summary: z.string().min(1).describe('1-paragraph executive summary of the incident'),
    rootCause: z.string().min(1).describe('Detailed technical explanation of the root cause found in the code'),
    evidenceRefs: z.array(z.string()).describe('List of evidence references (e.g., trace_id, metric, commit)'),
    suspectFilePath: z.string().min(1).describe('Path of the remediated file (e.g., apps/target-app-demo/src/repositories/payment.repository.ts)'),
    patchedContent: z.string().min(1).describe('Full contents of the fixed file ready to commit'),
    explanation: z.string().min(1).describe('Explanation of the change made in the patch and how it resolves the incident')
  })
  .strict();

export type RcaAndPatchSynthesis = z.infer<typeof RcaAndPatchSynthesisSchema>;
```

### 2.4 Parámetros de ejecución del LLM
- **Proveedor:** `${LLM_PROVIDER}` (por defecto: `gemini`; soporta `openai`, `openai-compatible`, `openrouter`, `groq`, `deepseek`, `ollama`, `vllm` con `LLM_BASE_URL` opcional y `anthropic`).
- **Modelo:** `${LLM_MODEL}` (por defecto: `gemini-3.5-flash`, con fallback operativo a `gemini-3.5-flash-lite` o los valores predeterminados del proveedor seleccionado).
- **Temperature:** `0.1` (baja variabilidad para garantizar previsibilidad y parches deterministas).
- **MaxOutputTokens:** `8192`.
- **Timeout:** `${LLM_TIMEOUT_MS}` (fallback legado: `${GEMINI_TIMEOUT_MS}`, por defecto: 25 000 ms / 25 s), con como máximo 1 reintento automático mediante backoff exponencial de 1 s.
- **Límite de archivo sospechoso:** hasta `24 000` caracteres devueltos por `inspect_git_deploy_diff` (`MAX_SUSPECT_FILE_CHARS`).

### 2.5 Validación defensiva del parche previa al PR
Antes de invocar la herramienta `create_remediation_pr`, el Orchestrator ejecuta una validación agnóstica de dominio sobre el parche sintetizado:
1. **Consistencia de ruta objetivo:** `synthesis.suspectFilePath === evidence.gitDiff.suspectFilePath` (debe coincidir con la ruta del archivo sospechoso autoritativa del diff de despliegue).
2. **Análisis sintáctico:** La TypeScript Compiler API (`ts.createSourceFile`) valida que `patchedContent` sea sintácticamente válido.
3. **Completitud dinámica de exportaciones y entrada:** Si `evidence.gitDiff.suspectFileContent` llega truncado por el límite de política (`[TRUNCATED_DIFF]`), el Orchestrator omite la síntesis vía LLM y enruta directamente a `DeterministicFallbackReasoningAdapter` para evitar parches parciales. Cuando está completo, extrae dinámicamente todas las declaraciones exportadas (`class`, `const`, `let`, `function`, `interface`, `type`, `enum`) y rechaza cualquier salida del LLM truncada o incompleta que las omita.
4. **Enrutamiento a fallback:** Si el JSON está malformado o falla cualquier validación, el Orchestrator aborta el uso de la síntesis del LLM y enruta inmediatamente a `DeterministicFallbackReasoningAdapter` (`reasoningSource: 'fallback'`).

---

## 3. Especificación de fallback determinista (`DeterministicFallbackReasoningAdapter`)

Para garantizar que la plataforma nunca falle en vivo incluso ante una indisponibilidad total de Gemini:
- **Origen de código confiable:** El adaptador recupera `payment.repository.ts` directamente de la versión saludable conocida (`v2.14.7`) — leyendo vía GitHub API (`GET /repos/:owner/:repo/contents/apps/target-app-demo/src/repositories/payment.repository.ts?ref=v2.14.7`) o archivo local en la rama `master`.
- **RCA determinista:**
  - `summary`: "Degradación crítica de latencia causada por saturación del pool de conexiones de la base de datos."
  - `rootCause`: "La versión v2.14.8 redujo el pool de conexiones a max: 2 y omitió la liberación de conexiones mediante client.release() en transacciones que agotan el tiempo de espera, provocando KnexTimeoutError."
  - `explanation`: "El parche restaura el bloque 'finally { client.release(); }' y el dimensionamiento del pool a max: 10 basándose en la versión saludable v2.14.7."
- **Metadatos:** Registra explícitamente `reasoningSource: 'fallback'`, con una insignia visible en el Dashboard y en el cuerpo del Pull Request.

---

## 4. Consultas concretas del stack de observabilidad

### 4.1 Regla de aprovisionamiento de Grafana Alerting (`infra/grafana/provisioning/alerting/rules.yaml`)
Regla de alertas unificadas de Grafana evaluada cada `10s` contra Prometheus (latencia `p95` o saturación del pool de BD):

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: payment-core-alerts
    folder: ZeroMTTR
    interval: 10s
    rules:
      - uid: payment-core-high-latency
        title: PaymentCoreHighLatencyOrPoolSaturation
        condition: A
        noDataState: OK
        execErrState: Error
        data:
          - refId: A
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: prometheus-datasource
            model:
              editorMode: code
              expr: '(histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="api-pagamentos-core"}[1m])) by (le)) > 0.5) or (db_pool_waiting{service="api-pagamentos-core"} > 0) or (payment_pool_connections_active{service="api-pagamentos-core"} >= 10)'
              instant: true
              range: false
              refId: A
```

### 4.2 LogQL (Loki)
- **Búsqueda por traza correlacionada:**
  `{service="api-pagamentos-core"} |= "trace_id=" |= "<trace_id>"`
- **Búsqueda por patrón de error de pool:**
  `{service="api-pagamentos-core"} |= "Pool exhausted" or "KnexTimeoutError"`

### 4.3 Mapeo de métricas OpenTelemetry (Node SDK → Prometheus Exporter)
| Métrica en código (`otel.ts`) | Tipo OTel | Nombre ingerido en Prometheus |
| :--- | :--- | :--- |
| `http_server_duration` | Histogram (ms) | `http_server_duration_milliseconds_bucket`, `_sum`, `_count` (con exemplars conteniendo `trace_id`) |
| `db_pool_waiting` | UpDownCounter / Gauge | `db_pool_waiting` |
| `db_pool_used` | UpDownCounter / Gauge | `db_pool_used` |

---

## 5. Matriz de versiones fijadas de dependencias

Para garantizar una reproducibilidad idéntica entre máquinas y agentes de IA, todas las versiones deben congelarse mediante `pnpm-lock.yaml`:

| Paquete / Herramienta | Versión exacta |
| :--- | :--- |
| **Node.js** | `24.x LTS` (Engine: `>=24.0.0`) |
| **pnpm** | `10.x` |
| **Nx** | `23.3.1` |
| **TypeScript** | `5.7.3` (`ES2024`, `NodeNext`) |
| **@modelcontextprotocol/sdk** | `1.6.0` |
| **@google/genai** | `0.1.2` |
| **Angular** | `22.2.5` |
| **PrimeNG** | `22.1.4` |
| **Tailwind CSS** | `4.0.6` |
| **Express** | `4.21.2` |
| **Knex** | `3.1.0` |
| **pg** | `8.13.1` |
| **Vitest** | `3.0.5` |
| **Zod** | `3.24.1` |
| **Supertest** | `7.0.0` |
| **Nock** | `14.0.0-beta.19` (o MSW `2.7.0` con soporte nativo de fetch en Node 24) |

---

## 6. Esquema de la instantánea de Replay (`data/last-recorded-incident.json`)

Cuando está en modo `replay` en el VPS público, el orquestador transmite mediante SSE los eventos grabados en `data/last-recorded-incident.json` con temporización acelerada (~3 s de retardo entre transiciones, totalizando ~25 s):

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
    "summary": "Critical degradation with p95 > 4.5s caused by PostgreSQL connection pool saturation.",
    "rootCause": "Commit 8f14e45 in v2.14.8 removed client.release() in timeout handling and reduced pool max to 2.",
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

### Procedimiento de grabación (`scripts/record-replay.sh`)
Al final de la Fase 5 (Ensayo Live), el script ejecuta una simulación `live` completa con `LIVE_DEMO_KEY`, lee el incidente completado desde `GET /api/incidents/{id}` y el estado objetivo desde `GET /api/target/status`, escribe `eventsTimeline` con nombres de pasos y retardos fijos, valida la instantánea con `ReplaySnapshotSchema` y la guarda en `data/last-recorded-incident.json` para alimentar la experiencia pública en el VPS.
