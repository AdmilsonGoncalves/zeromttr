# TECH 09 — Shared Contracts, LLM Synthesis (`ReasoningPort`), Queries, and Baseline

**Depends on:** [01](./01_foundation_and_infrastructure.md), [02](./02_mcp_server.md), [05](./05_orchestrator.md) · **Applies to:** 2, 4, 4b, 5
**Objective:** Formalize the LLM input and output contract (`ReasoningPort`), the deterministic fallback specification, shared Zod schemas in `libs/contracts`, exact observability queries (PromQL, LogQL, TraceQL), pinned dependency versions, and the Replay snapshot schema.

---

## 1. Shared Contracts Library (`libs/contracts/`)

To avoid type divergence and code duplication across `apps/mcp-server`, `apps/orchestrator`, and `apps/dashboard`, Zod contracts are centralized in the shared library **`libs/contracts`** (`@zeromttr/contracts`):

```text
libs/contracts/src/
  tools/            # Zod input (inputSchema) and output schemas for the 8 MCP tools
  llm/              # Structured input and output schemas for ReasoningPort
  incident/         # FSM states, SSE events, IncidentDetail, and PiiGuardAudit
  index.ts          # Single export entrypoint
```

### 1.1 Zod Schemas for the 8 MCP Tools
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

### 1.2 Neutral Target Workload Status Contract (`incident/incident.schema.ts`)
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

## 2. LLM Synthesis Contract (`ReasoningPort`)

The `GeminiReasoningAdapter` consumes the Google Gemini API (`@google/genai`) strictly using **Structured Outputs** (`responseMimeType: 'application/json'` with `responseSchema`).

### 2.1 Canonical System Prompt
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

### 2.2 Input Schema (`CollectedEvidence`)
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

### 2.3 Gemini Structured Output Schema (`RcaAndPatchSynthesis`)
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

### 2.4 LLM Execution Parameters
- **Provider:** `${LLM_PROVIDER}` (default: `gemini`; supports `openai`, `openai-compatible`, `openrouter`, `groq`, `deepseek`, `ollama`, `vllm` with optional `LLM_BASE_URL`, and `anthropic`).
- **Model:** `${LLM_MODEL}` (default: `gemini-3.5-flash`, with operational fallback to `gemini-3.5-flash-lite` or the selected provider defaults).
- **Temperature:** `0.1` (low variability to ensure predictability and deterministic patches).
- **MaxOutputTokens:** `8192`.
- **Timeout:** `${LLM_TIMEOUT_MS}` (legacy fallback: `${GEMINI_TIMEOUT_MS}`, default: 25,000 ms / 25 s), with at most 1 automatic retry using 1 s exponential backoff.
- **Suspect File Diff Cap:** up to `24,000` chars returned by `inspect_git_deploy_diff` (`MAX_SUSPECT_FILE_CHARS`).

### 2.5 Defensive Pre-PR Patch Validation
Before invoking the `create_remediation_pr` tool, the Orchestrator runs domain-agnostic validation on the synthesized patch:
1. **Target Path Consistency:** `synthesis.suspectFilePath === evidence.gitDiff.suspectFilePath` (must match the authoritative suspect file path from the deploy diff).
2. **Syntactic Parsing:** The TypeScript Compiler API (`ts.createSourceFile`) validates that `patchedContent` is syntactically valid.
3. **Dynamic Export & Input Completeness:** If `evidence.gitDiff.suspectFileContent` was truncated at the policy cap (`[TRUNCATED_DIFF]`), the Orchestrator skips LLM synthesis and routes directly to `DeterministicFallbackReasoningAdapter` so a partial file never produces an incomplete PR. Otherwise, it dynamically extracts all exported declarations (`class`, `const`, `let`, `function`, `interface`, `type`, `enum`) and rejects any truncated or stubbed LLM output that omits them.
4. **Fallback Routing:** If the JSON is malformed or any validation fails, the Orchestrator aborts using the LLM synthesis and immediately routes to `DeterministicFallbackReasoningAdapter` (`reasoningSource: 'fallback'`).

---

## 3. Deterministic Fallback Specification (`DeterministicFallbackReasoningAdapter`)

To ensure the platform never fails live even in the event of total Gemini unavailability:
- **Trusted Code Source:** The adapter retrieves `payment.repository.ts` directly from the known healthy version (`v2.14.7`) — reading via GitHub API (`GET /repos/:owner/:repo/contents/apps/target-app-demo/src/repositories/payment.repository.ts?ref=v2.14.7`) or local file on the `master` branch.
- **Deterministic RCA:**
  - `summary`: "Critical latency degradation caused by database connection pool saturation."
  - `rootCause`: "Release v2.14.8 reduced the connection pool to max: 2 and omitted connection release via client.release() in transactions that time out, triggering KnexTimeoutError."
  - `explanation`: "The patch restores the 'finally { client.release(); }' block and pool sizing to max: 10 based on the healthy v2.14.7 version."
- **Metadata:** Explicitly records `reasoningSource: 'fallback'`, with a visible badge in the Dashboard and in the Pull Request body.

---

## 4. Concrete Observability Stack Queries

### 4.1 Grafana Alerting Provisioning Rule (`infra/grafana/provisioning/alerting/rules.yaml`)
Grafana unified alerting rule evaluated every `10s` against Prometheus (`p95` latency or DB pool saturation):

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
- **Search by correlated trace:**
  `{service="api-pagamentos-core"} |= "trace_id=" |= "<trace_id>"`
- **Search by pool error pattern:**
  `{service="api-pagamentos-core"} |= "Pool exhausted" or "KnexTimeoutError"`

### 4.3 OpenTelemetry Metric Mapping (Node SDK → Prometheus Exporter)
| Metric in Code (`otel.ts`) | OTel Type | Ingested Name in Prometheus |
| :--- | :--- | :--- |
| `http_server_duration` | Histogram (ms) | `http_server_duration_milliseconds_bucket`, `_sum`, `_count` (with exemplars containing `trace_id`) |
| `db_pool_waiting` | UpDownCounter / Gauge | `db_pool_waiting` |
| `db_pool_used` | UpDownCounter / Gauge | `db_pool_used` |

---

## 5. Pinned Dependency Versions Matrix

To ensure identical reproducibility across machines and AI agents, all versions must be frozen via `pnpm-lock.yaml`:

| Package / Tool | Exact Version |
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
| **Nock** | `14.0.0-beta.19` (or MSW `2.7.0` with native Node 24 fetch support) |

---

## 6. Replay Snapshot Schema (`data/last-recorded-incident.json`)

When in `replay` mode on the public VPS, the orchestrator streams the events recorded in `data/last-recorded-incident.json` via SSE with accelerated timing (~3 s delay between transitions, totaling ~25 s):

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

### Recording Procedure (`scripts/record-replay.sh`)
At the end of Phase 5 (Live rehearsal), the script executes a complete `live` simulation with `LIVE_DEMO_KEY`, reads the completed incident from `GET /api/incidents/{id}` and target status from `GET /api/target/status`, writes `eventsTimeline` with fixed step names and delays, validates the snapshot with `ReplaySnapshotSchema`, and saves it to `data/last-recorded-incident.json` to power the public VPS experience.
