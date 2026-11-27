# 📐 ZeroMTTR — Behavioral and Static System Diagrams

| Field | Value |
| :--- | :--- |
| **Project** | ZeroMTTR — Autonomous AIOps & Incident Remediation |
| **Track** | Logistics & Automation (Operational workflow automation and cross-system integrations) |
| **Master Document** | [`00_architecture_master.md`](./00_architecture_master.md) |
| **Scope** | Behavioral modeling (Use Cases and Sequence) and structural/static modeling (Hexagonal Classes and Network Topology) |

---

## 1. Use Case Diagram

Visually defines the **Actors** (including external MCP clients such as Cursor / Claude Desktop / MCP Inspector), **Interactive Operation / Human Governance (Human-in-the-Loop)**, the **Autonomous Pipeline (Zero-Touch)**, and **External Integrations**.

```mermaid
flowchart TD
    subgraph Actors["1. Actors, MCP Clients & Triggers"]
        SRE(["SRE / On-Call Engineer"])
        EXT_MCP(["External MCP Client (Cursor / Claude / Inspector)"])
        GRAF(["Grafana Alerting"])
    end

    subgraph ZeroMTTR_Boundary["2. ZeroMTTR System Boundary"]
        subgraph Interactive_Operation["2A. War Room & Governance (Human-in-the-Loop)"]
            UC_SIM(["Simulate / Restore Incident (Live w/ Key or Public Replay)"])
            UC_MON(["Monitor Pipeline, FinOps, and Evidence via SSE"])
            UC_PII(["Audit PII Masking (OTTL Transform + PiiPromptGuard)"])
            UC_DEC(["Approve or Reject Hotfix (Via Email-Exclusive HMAC Link)"])
            UC_CFG(["Tune Runtime Policies & Review Audit Log (SQLite + SETTINGS_ADMIN_TOKEN)"])
            UC_EXT(["Explore the 8 AIOps Tools via Open MCP Contract (.mcp.json)"])
        end

        subgraph Autonomous_Pipeline["2B. Autonomous Pipeline (Zero-Touch)"]
            UC_ALT(["1. Receive and Deduplicate Alert by Fingerprint"])
            UC_RCA(["2. Execute RCA via MCP (PromQL + Tempo + Sanitized Loki)"])
            UC_COV(["3. Compute Evidence Coverage (0-4 Signals) and Blast Radius"])
            UC_FIN(["4. Account for Payload Reduction (FinOps Context Pruning)"])
            UC_DIFF(["5. Inspect Real Diff (healthy-version...buggy-version) in Target Repo"])
            UC_GUARD(["6. Audit Prompt with PiiPromptGuard (Fail-Closed)"])
            UC_ANN(["7. Inject Remediation Annotation into Grafana Chart"])
            UC_PR(["8. Generate Patch & Open PR in Target Repo (hotfix/*)"])
            UC_NOT(["9. Send Post-Mortem with Exclusive HMAC Links via Email"])
        end
    end

    subgraph External_Providers["3. External Integrations & CI"]
        LLM(["LLM Provider (ReasoningPort)"])
        GH(["GitHub API & Target Repository"])
        GHCI(["GitHub Actions (Hotfix Verification CI)"])
        RS(["Email Service (Post-Mortem to On-Call Engineer)"])
    end

    %% SRE and External MCP Client Actions
    SRE --> UC_SIM
    SRE --> UC_MON
    SRE --> UC_PII
    SRE --> UC_DEC
    SRE --> UC_CFG
    EXT_MCP --> UC_EXT

    %% Grafana Trigger
    GRAF --> UC_ALT

    %% Autonomous Flow
    UC_ALT --> UC_RCA
    UC_RCA --> UC_COV
    UC_RCA --> UC_FIN
    UC_COV --> UC_DIFF
    UC_DIFF --> UC_GUARD
    UC_GUARD --> UC_ANN
    UC_GUARD --> UC_PR
    UC_PR --> UC_NOT

    %% External Integrations
    UC_RCA <--> LLM
    UC_DIFF <--> GH
    UC_ANN --> GRAF
    UC_PR <--> LLM
    UC_PR --> GH
    GH -->|"Triggers PR validation"| GHCI
    UC_NOT --> RS
    RS -->|"Delivers exclusive HMAC link"| SRE
    SRE -.->|"Clicks link in email"| UC_DEC
```

---

## 2. End-to-End Sequence Diagram (Behavioral Flow)

Represents the complete chronological interaction across containers and external APIs, highlighting:
1. PII masking in the log body (`transform` OTTL in the Collector) **before** storage in Loki;
2. Deterministic validation by **`PiiPromptGuard`** **before** sending the prompt to Gemini;
3. Inspection of real tags `v2.14.7...v2.14.8` (`apps/target-app-demo`) and opening the PR against branch `release/target-v2.14.8` in repository `AdmilsonGoncalves/zeromttr`;
4. Segregation between `GRAFANA_WEBHOOK_TOKEN` and `DASHBOARD_API_TOKEN`, keeping the **HMAC `decisionToken` restricted exclusively to the email sent by Resend** (never exposed in SSE or `GET /api/incidents/:id`).

```mermaid
sequenceDiagram
    autonumber
    actor SRE as SRE Engineer
    participant UI as War Room Dashboard (Angular + Nginx)
    participant DEMO as Monitored Service (OTel SDK)
    participant OTEL as OTel Collector (OTTL Transform PII Masking)
    participant LGTM as LGTM Stack (Prom/Loki/Tempo/Grafana)
    participant ORCH as Orchestrator (State Machine + PiiPromptGuard)
    participant MCP as MCP Server (8 Tools + FinOps)
    participant EXT as External APIs (LLM / GitHub / Email)

    Note over SRE,DEMO: Phase 1 — Anomaly Generation and Edge OTTL Masking
    SRE->>UI: Clicks "Simulate Incident" (POST /api/demo/chaos)
    UI->>ORCH: POST /api/demo/chaos (Bearer DASHBOARD_API_TOKEN + X-Live-Demo-Key)
    ORCH->>DEMO: Activates controlled degradation (when supported by target service)
    DEMO-->>OTEL: Emits error Spans, Metrics, and Logs with PII via OTLP (4318)
    Note right of OTEL: transform processor (OTTL replace_pattern) masks PII and tokens in log.body and attributes
    OTEL->>LGTM: Persists metrics (with exemplars), traces, and already-masked logs ([REDACTED_CPF], Bearer [REDACTED_TOKEN])

    Note over LGTM,ORCH: Phase 2 — Detection and Asynchronous Incident Creation
    LGTM->>ORCH: POST /webhook/grafana-alert (Bearer GRAFANA_WEBHOOK_TOKEN)
    ORCH->>ORCH: Validates payload (Zod), computes fingerprint, and creates Incident(RECEIVED)
    ORCH-->>LGTM: 202 Accepted (processing continues in background)
    ORCH-->>UI: SSE event: incident.created & incident.transition (INVESTIGATING)

    Note over ORCH,MCP: Phase 3 — OTel Collection via MCP, FinOps, and Evidence Coverage
    ORCH->>MCP: CallTool: execute_promql_range
    MCP->>LGTM: Queries PromQL series + Exemplars
    MCP-->>ORCH: Summarized series + trace_id + FinOps (raw vs. compacted bytes) [Signals 1/4 and 2/4 = 50%]
    ORCH->>MCP: CallTool: analyze_otel_trace (trace_id)
    MCP->>LGTM: Fetches Span tree in Tempo
    MCP-->>ORCH: Top 5 slow/error spans + services_involved (Blast Radius) [Signal 3/4 = 75%]
    ORCH->>MCP: CallTool: query_loki_logs (trace_id)
    MCP->>LGTM: LogQL filtered by trace_id
    MCP-->>ORCH: Masked logs ([REDACTED_CPF]) + FinOps telemetry
    ORCH->>DEMO: GET /ops/status (TargetStatusPort)
    DEMO-->>ORCH: status="degraded", version="<buggy-version>", previousHealthyVersion="<healthy-version>", capabilities, saturation

    Note over ORCH,EXT: Phase 4 — Real Diff (healthy-version...buggy-version) on GitHub & PiiPromptGuard Audit (Fail-Closed)
    ORCH-->>UI: SSE event: incident.transition (ENRICHING)
    ORCH->>MCP: CallTool: inspect_git_deploy_diff (base_ref, head_ref, service_path)
    MCP->>EXT: GitHub API (Target Repo): Compare healthy-version...buggy-version & Get File Content
    EXT-->>MCP: Regression commit, real diff of suspect file, and blob sha
    MCP-->>ORCH: Truncated diff (<= 1500 chars) + FinOps telemetry [Signal 4/4 = 100% (4/4 Signals)]
    ORCH->>ORCH: PiiPromptGuard.inspect(prompt): validates sensitive patterns and JWT (leakedPatternsDetected === 0)
    ORCH-->>UI: SSE events: incident.finops, incident.docs

    Note over ORCH,EXT: Phase 5 — Patch Synthesis, Grafana Annotation, and PR Creation
    ORCH-->>UI: SSE event: incident.transition (REMEDIATING)
    ORCH->>MCP: CallTool: annotate_grafana_incident (tag: aiops-remediation)
    MCP->>LGTM: POST /api/annotations
    ORCH->>EXT: ReasoningPort (LLM Provider): synthesizes RCA + generates patch (records reasoningSource="llm")
    EXT-->>ORCH: Fixed code (patch)
    ORCH-->>UI: SSE event: incident.rca (Evidence 4/4, Blast Radius, PiiGuardAudit, reasoningSource)
    ORCH-->>UI: SSE event: incident.transition (AWAITING_PR)
    ORCH->>MCP: CallTool: create_remediation_pr (incident_id, file_path, patched_content, blob_sha, title, rca_markdown, reasoning_source)
    MCP->>EXT: GitHub API (Target Repo): creates hotfix/* branch, commits fix, and opens Pull Request against base branch
    EXT-->>MCP: branchUrl + pullRequestUrl + commitSha (triggers verification CI in target repo)
    MCP-->>ORCH: RemediationPrReceipt
    ORCH-->>UI: SSE event: incident.remediation (branchUrl, pullRequestUrl, commitSha)

    Note over ORCH,SRE: Phase 6 — Post-Mortem Email with Exclusive HMAC in URI Fragment (#)
    ORCH->>ORCH: Generates approveSig, rejectSig, and exp via HMAC-SHA256 (NOT persisted in public API or SSE)
    ORCH->>MCP: CallTool: send_post_mortem_resend (escaped HTML + /decision/:id#action=...&sig=...&exp=... links)
    MCP->>EXT: Email Service: POST /emails (configured sender)
    EXT-->>SRE: Delivers Post-Mortem email with signed Approve / Reject buttons
    ORCH-->>UI: SSE event: incident.transition (NOTIFIED) & incident.notified (only emailId and sanitized htmlPreview, NO sig)

    SRE->>UI: Opens email link (/decision/:id#action=approve&sig=...&exp=...) and confirms (# fragment never hits HTTP logs)
    UI->>ORCH: POST /api/incidents/:id/decision { action: "approve", sig, exp }
    ORCH->>ORCH: Validates HMAC signature + expiration + NOTIFIED state and transitions state to RESOLVED
    ORCH->>MCP: CallTool: annotate_grafana_incident ("Incident RESOLVED by human approval")
    ORCH-->>UI: 200 OK + SSE event: incident.decision & incident.transition (RESOLVED)
```

---

## 3. Class Diagrams — Hexagonal Architecture

Because `apps/orchestrator` and `apps/mcp-server` follow **Hexagonal Architecture (Ports & Adapters)** with **mandatory TDD**, the diagrams below present the domain entities (including `PiiPromptGuard` and `EvidenceCoverage`), use cases, ports (interfaces), and adapters.

### 3.1 `apps/orchestrator` — Domain and Ports

```mermaid
classDiagram
    direction TB

    class Incident {
        +string id
        +string fingerprint
        +string service
        +string severity
        +IncidentState state
        +string mode
        +Date startedAt
        +TransitionRecord[] transitions
        +RcaReport rca
        +FinOpsSummary finops
        +DeployDiffSource[] docs
        +RemediationInfo remediation
        +NotificationInfo notification
        +string decision
        +string decisionSource
        +applyTransition(to: IncidentState, at: Date, reason?: string) void
    }

    class IncidentState {
        <<enumeration>>
        RECEIVED
        INVESTIGATING
        ENRICHING
        REMEDIATING
        AWAITING_PR
        NOTIFIED
        RESOLVED
        REJECTED
        FAILED
        +canTransitionTo(from: IncidentState, to: IncidentState)$ boolean
    }

    class RcaReport {
        +string summary
        +string reasoningSource
        +number evidenceCoveragePercent
        +number signalsCollected
        +number signalsTotal
        +EvidenceBreakdown evidenceBreakdown
        +string[] blastRadius
        +number diagnosisSeconds
        +string traceId
        +string criticalSpan
        +SpanNode[] spans
        +string rawEdgeLogPreCollector
        +string logSample
        +PiiGuardAudit piiGuardAudit
        +string deployVersion
        +string[] mitigations
        +number grafanaAnnotationId
    }

    class PiiPromptGuard {
        +inspectAndEnforceFailClosed(promptText: string)$ PiiGuardAudit
    }

    class DecisionHmac {
        +sign(incidentId: string, action: string, exp: number, secret: string)$ string
        +verify(incidentId: string, action: string, sig: string, exp: number, now: number, secret: string)$ boolean
    }

    class IncidentRepository {
        <<interface>>
        +findById(id: string) Promise~Incident~
        +findOpenByFingerprint(fp: string) Promise~Incident~
        +findLatestByFingerprint(fp: string) Promise~Incident~
        +findAll() Promise~Incident[]~
        +save(incident: Incident) Promise~void~
    }

    class SettingsRepositoryPort {
        <<interface>>
        +getSettings() SystemSettings
        +updateSettings(patch: SystemSettingsPatch, actor: string) SystemSettings
        +listAuditEntries(limit?: number) SettingsAuditEntry[]
    }

    class ToolsPort {
        <<interface>>
        +executePromqlRange(input: PromqlInput) Promise~PromqlOutput~
        +queryLokiLogs(input: LokiInput) Promise~LokiOutput~
        +analyzeOtelTrace(traceId: string) Promise~TraceAnalysisOutput~
        +searchTracesByTraceQL(input: TraceQlInput) Promise~TraceQlOutput~
        +inspectGitDeployDiff(input: GitDiffInput) Promise~GitDiffOutput~
        +createRemediationPr(input: CreatePrInput) Promise~CreatePrOutput~
        +sendPostMortemResend(input: ResendInput) Promise~ResendOutput~
        +annotateGrafanaIncident(input: AnnotationInput) Promise~AnnotationOutput~
    }

    class ReasoningPort {
        <<interface>>
        +synthesizeRcaAndPatch(evidence: CollectedEvidence) Promise~RcaAndPatchSynthesis~
    }

    class TargetStatusPort {
        <<interface>>
        +getStatus() Promise~TargetStatus~
    }

    Incident *-- IncidentState
    Incident *-- RcaReport
    RcaReport ..> PiiPromptGuard
```

### 3.2 `apps/orchestrator` — Use Cases and Adapters

```mermaid
classDiagram
    direction TB

    class HandleAlert {
        +execute(payload: GrafanaWebhookPayload) Promise~Incident~
    }
    class InvestigateIncident {
        +execute(incidentId: string) Promise~RcaReport~
    }
    class EnrichWithDeployDiff {
        +execute(incidentId: string) Promise~DeployDiffSource[]~
    }
    class DispatchRemediation {
        +execute(incidentId: string) Promise~RemediationInfo~
    }
    class NotifyOnCall {
        +execute(incidentId: string) Promise~NotificationInfo~
    }
    class RecordDecision {
        +execute(incidentId: string, action: string, sig: string, exp: number) Promise~Incident~
        +executeSimulated(incidentId: string, action: string) Promise~Incident~
    }

    class IncidentRepository {
        <<interface>>
    }
    class ToolsPort {
        <<interface>>
    }
    class ReasoningPort {
        <<interface>>
    }
    class TargetStatusPort {
        <<interface>>
    }
    class SettingsRepositoryPort {
        <<interface>>
    }

    class FileIncidentRepository
    class SqliteSettingsRepository
    class McpClientAdapter
    class GeminiReasoningAdapter
    class DeterministicFallbackReasoningAdapter
    class HttpTargetStatusAdapter
    class PrometheusTargetStatusAdapter

    HandleAlert --> IncidentRepository
    HandleAlert --> SettingsRepositoryPort
    InvestigateIncident --> ToolsPort
    InvestigateIncident --> TargetStatusPort
    InvestigateIncident --> IncidentRepository
    EnrichWithDeployDiff --> ToolsPort
    EnrichWithDeployDiff --> SettingsRepositoryPort
    EnrichWithDeployDiff --> IncidentRepository
    DispatchRemediation --> ReasoningPort
    DispatchRemediation --> ToolsPort
    DispatchRemediation --> IncidentRepository
    NotifyOnCall --> ToolsPort
    NotifyOnCall --> SettingsRepositoryPort
    NotifyOnCall --> IncidentRepository
    RecordDecision --> IncidentRepository
    RecordDecision --> ToolsPort

    FileIncidentRepository ..|> IncidentRepository
    SqliteSettingsRepository ..|> SettingsRepositoryPort
    McpClientAdapter ..|> ToolsPort
    GeminiReasoningAdapter ..|> ReasoningPort
    DeterministicFallbackReasoningAdapter ..|> ReasoningPort
    HttpTargetStatusAdapter ..|> TargetStatusPort
    PrometheusTargetStatusAdapter ..|> TargetStatusPort
    PrometheusTargetStatusAdapter --> ToolsPort
```

---

### 3.3 `apps/mcp-server` — Pure Domain, 8 Tools, Ports, and HTTP Adapters

```mermaid
classDiagram
    direction TB

    class SeriesSummarizer {
        +summarize(series: RawPromSeries[], maxSeries: number)$ SeriesSummary[]
    }
    class LogTruncator {
        +truncateLines(lines: string[], maxLines: number, maxChars: number)$ string[]
    }
    class SpanAnalyzer {
        +analyze(spans: RawSpan[])$ TraceSummary
    }
    class FinOpsCalculator {
        +calculate(rawBytes: number, compactedBytes: number)$ FinOpsMetrics
    }

    class ExecutePromqlRange {
        +execute(input: PromqlToolInput) Promise~PromqlToolOutput~
    }
    class QueryLokiLogs {
        +execute(input: LokiToolInput) Promise~LokiToolOutput~
    }
    class AnalyzeOtelTrace {
        +execute(input: TraceToolInput) Promise~TraceToolOutput~
    }
    class SearchTracesByTraceQL {
        +execute(input: TraceQlToolInput) Promise~TraceQlToolOutput~
    }
    class InspectGitDeployDiff {
        +execute(input: GitDiffToolInput) Promise~GitDiffToolOutput~
    }
    class CreateRemediationPr {
        +execute(input: CreatePrToolInput) Promise~CreatePrToolOutput~
    }
    class SendPostMortemResend {
        +execute(input: ResendToolInput) Promise~ResendToolOutput~
    }
    class AnnotateGrafanaIncident {
        +execute(input: AnnotationToolInput) Promise~AnnotationToolOutput~
    }

    class MetricsPort {
        <<interface>>
    }
    class LogsPort {
        <<interface>>
    }
    class TracesPort {
        <<interface>>
    }
    class RepoInspectorPort {
        <<interface>>
    }
    class RemediationPort {
        <<interface>>
    }
    class NotifierPort {
        <<interface>>
    }
    class AnnotationPort {
        <<interface>>
    }

    class PrometheusHttpAdapter
    class LokiHttpAdapter
    class TempoHttpAdapter
    class GithubInspectorHttpAdapter
    class GithubRemediationHttpAdapter
    class ResendHttpAdapter
    class GrafanaAnnotationsHttpAdapter

    ExecutePromqlRange --> SeriesSummarizer
    ExecutePromqlRange --> FinOpsCalculator
    ExecutePromqlRange --> MetricsPort

    QueryLokiLogs --> LogTruncator
    QueryLokiLogs --> FinOpsCalculator
    QueryLokiLogs --> LogsPort

    AnalyzeOtelTrace --> SpanAnalyzer
    AnalyzeOtelTrace --> TracesPort

    SearchTracesByTraceQL --> TracesPort

    InspectGitDeployDiff --> FinOpsCalculator
    InspectGitDeployDiff --> RepoInspectorPort

    CreateRemediationPr --> RemediationPort
    SendPostMortemResend --> NotifierPort
    AnnotateGrafanaIncident --> AnnotationPort

    PrometheusHttpAdapter ..|> MetricsPort
    LokiHttpAdapter ..|> LogsPort
    TempoHttpAdapter ..|> TracesPort
    GithubInspectorHttpAdapter ..|> RepoInspectorPort
    GithubRemediationHttpAdapter ..|> RemediationPort
    ResendHttpAdapter ..|> NotifierPort
    GrafanaAnnotationsHttpAdapter ..|> AnnotationPort
```

---

## 4. Static Deployment and Network Isolation Diagram

Illustrates defense in depth on the Linux VPS:
- **No container publishes host ports (`ports:` omitted)**;
- Only the `dashboard` container (Nginx) participates simultaneously in the external Traefik network (`traefik_default` / `${TRAEFIK_NETWORK_NAME}`) and the isolated internal network (`aiops-net`);
- **Strict credential segregation:** Nginx injects `Authorization: Bearer ${DASHBOARD_API_TOKEN}` on Dashboard `/api/*` routes, while Grafana Alerting uses an exclusive token (`GRAFANA_WEBHOOK_TOKEN`) to trigger `POST /webhook/grafana-alert` internally on the `aiops-net` network.

```mermaid
flowchart TD
    subgraph Internet["1. Public Internet"]
        USER(["SRE Browser / Visitor"])
        CF["Cloudflare Proxy (DNS + WAF + Bypass Cache on /api/events*)"]
    end

    subgraph VPS["2. Linux VPS (Zero Telemetry Ports Exposed on Host)"]
        subgraph External_Network["2A. External Docker Network: traefik_default (TRAEFIK_NETWORK_NAME)"]
            TRAEFIK["Traefik Reverse Proxy (Let's Encrypt TLS :443)"]
            DASH["zeromttr-dashboard (Nginx :80 + Angular SPA)"]
        end

        subgraph Internal_Network["2B. Isolated Docker Network: aiops-net (expose: only)"]
            ORCH["zeromttr-orchestrator (:8080 + SQLite /app/var)"]
            MCP["zeromttr-mcp-server (:8000)"]
            DEMO["Monitored Service (:3001 — OTel SDK)"]
            PG[("Target Database (:5432)")]
            OTEL["zeromttr-otel-collector (:4317 / :4318 — OTTL Transform)"]
            PROM[("zeromttr-prometheus (:9090 — 512M)")]
            LOKI[("zeromttr-loki (:3100 — 512M)")]
            TEMPO[("zeromttr-tempo (:3200 — 384M)")]
            GRAF["zeromttr-grafana (:3000)"]
        end
    end

    subgraph Cloud_APIs["3. External APIs (Outbound HTTPS)"]
        GEMINI["LLM Provider (Structured PII Masked)"]
        GITHUB["GitHub REST API (Target Repository)"]
        RESEND["Email Service (Exclusive HMAC Links)"]
    end

    USER -->|"HTTPS (public domain)"| CF
    CF -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"HTTP :80 (X-Accel-Buffering: no)"| DASH
    DASH -->|"Proxy /api/* + Bearer DASHBOARD_API_TOKEN"| ORCH

    ORCH <-->|"MCP Streamable HTTP (:8000 + MCP_AUTH_TOKEN)"| MCP
    ORCH -->|"Status / Control (:3001)"| DEMO
    ORCH <-->|"ReasoningPort (PiiPromptGuard)"| GEMINI
    GRAF -->|"POST /webhook/grafana-alert (GRAFANA_WEBHOOK_TOKEN)"| ORCH

    DEMO -->|"SQL (:5432)"| PG
    DEMO -->|"OTLP/HTTP (:4318)"| OTEL

    OTEL -->|"Remote Write + Exemplars"| PROM
    OTEL -->|"Logs (OTTL Masked)"| LOKI
    OTEL -->|"Traces (Tail Sampled)"| TEMPO

    MCP -->|"PromQL"| PROM
    MCP -->|"LogQL"| LOKI
    MCP -->|"TraceQL"| TEMPO
    MCP -->|"POST /api/annotations"| GRAF
    MCP <-->|"Diff healthy-version...buggy-version & Pull Request"| GITHUB
    MCP -->|"POST /emails"| RESEND
```
