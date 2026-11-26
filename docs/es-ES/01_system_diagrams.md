# 📐 ZeroMTTR — Diagramas de comportamiento y estáticos del sistema

| Campo | Valor |
| :--- | :--- |
| **Proyecto** | ZeroMTTR — AIOps autónomo y remediación de incidentes |
| **Línea** | Logística y Automatización (automatización de flujos de trabajo operativos e integraciones entre sistemas) |
| **Documento maestro** | [`00_architecture_master.md`](./00_architecture_master.md) |
| **Alcance** | Modelado de comportamiento (Casos de uso y Secuencia) y modelado estructural/estático (Clases hexagonales y Topología de red) |

---

## 1. Diagrama de casos de uso

Define visualmente los **Actores** (incluidos clientes MCP externos como Cursor / Claude Desktop / MCP Inspector), la **Operación interactiva / Gobernanza humana (Human-in-the-Loop)**, el **Pipeline autónomo (Zero-Touch)** y las **Integraciones externas**.

```mermaid
flowchart TD
    subgraph Actors["1. Actores, clientes MCP y disparadores"]
        SRE(["SRE / Ingeniero de guardia"])
        EXT_MCP(["Cliente MCP externo (Cursor / Claude / Inspector)"])
        GRAF(["Grafana Alerting"])
    end

    subgraph ZeroMTTR_Boundary["2. Límite del sistema ZeroMTTR"]
        subgraph Interactive_Operation["2A. War Room y Gobernanza (Human-in-the-Loop)"]
            UC_SIM(["Simular / Restaurar incidente (Live con clave o Replay público)"])
            UC_MON(["Monitorizar pipeline, FinOps y evidencias vía SSE"])
            UC_PII(["Auditar enmascaramiento de PII (Transform OTTL + PiiPromptGuard)"])
            UC_DEC(["Aprobar o rechazar hotfix (vía enlace HMAC exclusivo por correo)"])
            UC_EXT(["Explorar las 8 herramientas AIOps mediante contrato MCP abierto (.mcp.json)"])
        end

        subgraph Autonomous_Pipeline["2B. Pipeline autónomo (Zero-Touch)"]
            UC_ALT(["1. Recibir y deduplicar alerta por fingerprint"])
            UC_RCA(["2. Ejecutar RCA vía MCP (PromQL + Tempo + Loki sanitizado)"])
            UC_COV(["3. Calcular Evidence Coverage (0-4 señales) y Blast Radius"])
            UC_FIN(["4. Contabilizar reducción de payload (FinOps Context Pruning)"])
            UC_DIFF(["5. Inspeccionar diff real (v2.14.7...v2.14.8) en repo objetivo"])
            UC_GUARD(["6. Auditar prompt con PiiPromptGuard (Fail-Closed)"])
            UC_ANN(["7. Inyectar anotación de remediación en gráfico de Grafana"])
            UC_PR(["8. Generar parche quirúrgico y abrir PR en repo objetivo (hotfix/*)"])
            UC_NOT(["9. Enviar Post-Mortem con enlaces HMAC exclusivos por correo"])
        end
    end

    subgraph External_Providers["3. Integraciones externas y CI"]
        LLM(["Proveedor LLM (Gemini API)"])
        GH(["GitHub API y Repositorio (AdmilsonGoncalves/zeromttr)"])
        GHCI(["GitHub Actions (hotfix-verify.yml)"])
        RS(["Resend API (Correo al ingeniero de guardia)"])
    end

    %% Acciones del SRE y Cliente MCP externo
    SRE --> UC_SIM
    SRE --> UC_MON
    SRE --> UC_PII
    SRE --> UC_DEC
    EXT_MCP --> UC_EXT

    %% Disparador de Grafana
    GRAF --> UC_ALT

    %% Flujo autónomo
    UC_ALT --> UC_RCA
    UC_RCA --> UC_COV
    UC_RCA --> UC_FIN
    UC_COV --> UC_DIFF
    UC_DIFF --> UC_GUARD
    UC_GUARD --> UC_ANN
    UC_GUARD --> UC_PR
    UC_PR --> UC_NOT

    %% Integraciones externas
    UC_RCA <--> LLM
    UC_DIFF <--> GH
    UC_ANN --> GRAF
    UC_PR <--> LLM
    UC_PR --> GH
    GH -->|"Dispara validación del PR"| GHCI
    UC_NOT --> RS
    RS -->|"Entrega enlace HMAC exclusivo"| SRE
    SRE -.->|"Hace clic en el enlace del correo"| UC_DEC
```

---

## 2. Diagrama de secuencia de extremo a extremo (Flujo de comportamiento)

Representa la interacción cronológica completa entre contenedores y APIs externas, destacando:
1. El enmascaramiento de PII en el cuerpo del log (`transform` OTTL en el Collector) **antes** del almacenamiento en Loki;
2. La validación determinista mediante **`PiiPromptGuard`** **antes** de enviar el prompt a Gemini;
3. La inspección de los tags reales `v2.14.7...v2.14.8` (`apps/target-app-demo`) y la apertura del PR contra la rama `release/target-v2.14.8` en el repositorio `AdmilsonGoncalves/zeromttr`;
4. La segregación entre `GRAFANA_WEBHOOK_TOKEN` y `DASHBOARD_API_TOKEN`, manteniendo el **HMAC `decisionToken` restringido exclusivamente al correo enviado por Resend** (nunca expuesto en SSE ni en `GET /api/incidents/:id`).

```mermaid
sequenceDiagram
    autonumber
    actor SRE as Ingeniero SRE
    participant UI as Panel War Room (Angular + Nginx)
    participant DEMO as target-app-demo (api-pagamentos-core)
    participant OTEL as OTel Collector (Transform OTTL enmascaramiento PII)
    participant LGTM as Stack LGTM (Prom/Loki/Tempo/Grafana)
    participant ORCH as Orchestrator (FSM + PiiPromptGuard)
    participant MCP as MCP Server (8 herramientas + FinOps)
    participant EXT as APIs externas (Gemini / GitHub / Resend)

    Note over SRE,DEMO: Fase 1 — Generación de anomalía y enmascaramiento OTTL en el borde
    SRE->>UI: Hace clic en "Simular Incidente" (POST /api/demo/chaos)
    UI->>ORCH: POST /api/demo/chaos (Bearer DASHBOARD_API_TOKEN + X-Live-Demo-Key)
    ORCH->>DEMO: POST /chaos/pool-saturation?enable=true
    DEMO-->>OTEL: Emite Spans de error, Métricas y Log con CPF/CNPJ/Clave PIX/JWT vía OTLP (4318)
    Note right of OTEL: transform processor (OTTL replace_pattern) enmascara CPF/CNPJ/PIX/JWT en log.body y atributos
    OTEL->>LGTM: Persiste métricas (con exemplars), trazas y logs ya enmascarados ([REDACTED_CPF], Bearer [REDACTED_TOKEN])

    Note over LGTM,ORCH: Fase 2 — Detección y creación asíncrona del incidente
    LGTM->>ORCH: POST /webhook/grafana-alert (Bearer GRAFANA_WEBHOOK_TOKEN)
    ORCH->>ORCH: Valida payload (Zod), calcula fingerprint y crea Incident(RECEIVED)
    ORCH-->>LGTM: 202 Accepted (el procesamiento continúa en segundo plano)
    ORCH-->>UI: Evento SSE: incident.created & incident.transition (INVESTIGATING)

    Note over ORCH,MCP: Fase 3 — Recolección OTel vía MCP, FinOps y Evidence Coverage
    ORCH->>MCP: CallTool: execute_promql_range
    MCP->>LGTM: Consulta series PromQL + Exemplars
    MCP-->>ORCH: Series resumidas + trace_id + FinOps (bytes brutos vs. compactados) [Señales 1/4 y 2/4 = 50%]
    ORCH->>MCP: CallTool: analyze_otel_trace (trace_id)
    MCP->>LGTM: Obtiene árbol de Spans en Tempo
    MCP-->>ORCH: Top 5 spans lentos/con error + services_involved (Blast Radius) [Señal 3/4 = 75%]
    ORCH->>MCP: CallTool: query_loki_logs (trace_id)
    MCP->>LGTM: LogQL filtrado por trace_id
    MCP-->>ORCH: Logs enmascarados ([REDACTED_CPF]) + telemetría FinOps
    ORCH->>DEMO: GET /ops/status (TargetStatusPort)
    DEMO-->>ORCH: status="degraded", version="v2.14.8", previousHealthyVersion="v2.14.7", capabilities, saturation

    Note over ORCH,EXT: Fase 4 — Diff real (v2.14.7...v2.14.8) en GitHub y auditoría PiiPromptGuard (Fail-Closed)
    ORCH-->>UI: Evento SSE: incident.transition (ENRICHING)
    ORCH->>MCP: CallTool: inspect_git_deploy_diff (base_ref: "v2.14.7", head_ref: "v2.14.8", service_path: "apps/target-app-demo")
    MCP->>EXT: GitHub API (AdmilsonGoncalves/zeromttr): Compare v2.14.7...v2.14.8 & Get File Content
    EXT-->>MCP: Commit de regresión, diff real de payment.repository.ts y blob sha
    MCP-->>ORCH: Diff truncado (<= 1500 chars) + telemetría FinOps [Señal 4/4 = 100% (4/4 Signals)]
    ORCH->>ORCH: PiiPromptGuard.inspect(prompt): valida CPF/CNPJ módulo-11 y JWT (leakedPatternsDetected === 0)
    ORCH-->>UI: Eventos SSE: incident.finops, incident.docs

    Note over ORCH,EXT: Fase 5 — Síntesis del parche, anotación en Grafana y creación de PR
    ORCH-->>UI: Evento SSE: incident.transition (REMEDIATING)
    ORCH->>MCP: CallTool: annotate_grafana_incident (tag: aiops-remediation)
    MCP->>LGTM: POST /api/annotations
    ORCH->>EXT: ReasoningPort (Gemini 3.5 Flash): sintetiza RCA + genera parche quirúrgico (registra reasoningSource="llm")
    EXT-->>ORCH: Código corregido (restaura finally { client.release() } y pool max: 10)
    ORCH-->>UI: Evento SSE: incident.rca (Evidence 4/4, Blast Radius, PiiGuardAudit, reasoningSource)
    ORCH-->>UI: Evento SSE: incident.transition (AWAITING_PR)
    ORCH->>MCP: CallTool: create_remediation_pr (incident_id, file_path, patched_content, blob_sha, title, rca_markdown, reasoning_source)
    MCP->>EXT: GitHub API (AdmilsonGoncalves/zeromttr): crea rama, realiza commit del fix y abre Pull Request contra release/target-v2.14.8
    EXT-->>MCP: branchUrl + pullRequestUrl + commitSha (dispara hotfix-verify.yml en el repo objetivo)
    MCP-->>ORCH: RemediationPrReceipt
    ORCH-->>UI: Evento SSE: incident.remediation (branchUrl, pullRequestUrl, commitSha)

    Note over ORCH,SRE: Fase 6 — Post-Mortem (Resend) con HMAC exclusivo en el fragmento URI (#) del correo
    ORCH->>ORCH: Genera approveSig, rejectSig y exp vía HMAC-SHA256 (NO persistido en API pública ni SSE)
    ORCH->>MCP: CallTool: send_post_mortem_resend (HTML escapado + enlaces /decision/:id#action=...&sig=...&exp=...)
    MCP->>EXT: Resend API: POST /emails (From: sre@zeromttr.agjworks.com)
    EXT-->>SRE: Entrega correo Post-Mortem con botones firmados Approve / Reject
    ORCH-->>UI: Evento SSE: incident.transition (NOTIFIED) & incident.notified (solo emailId y htmlPreview sanitizado, SIN sig)

    SRE->>UI: Abre el enlace del correo (/decision/:id#action=approve&sig=...&exp=...) y confirma (el fragmento # nunca llega a logs HTTP)
    UI->>ORCH: POST /api/incidents/:id/decision { action: "approve", sig, exp }
    ORCH->>ORCH: Valida firma HMAC + expiración + estado NOTIFIED y transiciona FSM a RESOLVED
    ORCH->>MCP: CallTool: annotate_grafana_incident ("Incident RESOLVED by human approval")
    ORCH-->>UI: 200 OK + Evento SSE: incident.decision & incident.transition (RESOLVED)
```

---

## 3. Diagramas de clases — Arquitectura hexagonal

Dado que `apps/orchestrator` y `apps/mcp-server` siguen una **Arquitectura Hexagonal (Ports & Adapters)** con **TDD obligatorio**, los diagramas siguientes presentan las entidades de dominio (incluidas `PiiPromptGuard` y `EvidenceCoverage`), casos de uso, puertos (interfaces) y adaptadores.

### 3.1 `apps/orchestrator` — Dominio y puertos

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
        +findAll() Promise~Incident[]~
        +save(incident: Incident) Promise~void~
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

### 3.2 `apps/orchestrator` — Casos de uso y adaptadores

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

    class FileIncidentRepository
    class McpClientAdapter
    class GeminiReasoningAdapter
    class DeterministicFallbackReasoningAdapter
    class HttpTargetStatusAdapter
    class PrometheusTargetStatusAdapter

    HandleAlert --> IncidentRepository
    InvestigateIncident --> ToolsPort
    InvestigateIncident --> TargetStatusPort
    InvestigateIncident --> IncidentRepository
    EnrichWithDeployDiff --> ToolsPort
    EnrichWithDeployDiff --> IncidentRepository
    DispatchRemediation --> ReasoningPort
    DispatchRemediation --> ToolsPort
    DispatchRemediation --> IncidentRepository
    NotifyOnCall --> ToolsPort
    NotifyOnCall --> IncidentRepository
    RecordDecision --> IncidentRepository
    RecordDecision --> ToolsPort

    FileIncidentRepository ..|> IncidentRepository
    McpClientAdapter ..|> ToolsPort
    GeminiReasoningAdapter ..|> ReasoningPort
    DeterministicFallbackReasoningAdapter ..|> ReasoningPort
    HttpTargetStatusAdapter ..|> TargetStatusPort
    PrometheusTargetStatusAdapter ..|> TargetStatusPort
    PrometheusTargetStatusAdapter --> ToolsPort
```

---

### 3.3 `apps/mcp-server` — Dominio puro, 8 herramientas, puertos y adaptadores HTTP

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

## 4. Diagrama estático de despliegue y aislamiento de red

Ilustra la defensa en profundidad en el VPS Linux:
- **Ningún contenedor publica puertos en el host (`ports:` omitido)**;
- Solo el contenedor `dashboard` (Nginx) participa simultáneamente en la red externa de Traefik (`traefik_default` / `${TRAEFIK_NETWORK_NAME}`) y en la red interna aislada (`aiops-net`);
- **Segregación estricta de credenciales:** Nginx inyecta `Authorization: Bearer ${DASHBOARD_API_TOKEN}` en las rutas `/api/*` del Dashboard, mientras que Grafana Alerting utiliza un token exclusivo (`GRAFANA_WEBHOOK_TOKEN`) para invocar `POST /webhook/grafana-alert` internamente dentro de la red `aiops-net`.

```mermaid
flowchart TD
    subgraph Internet["1. Internet pública"]
        USER(["Navegador SRE / Visitante"])
        CF["Cloudflare Proxy (DNS + WAF + Omitir caché en /api/events*)"]
    end

    subgraph VPS["2. VPS Linux (Cero puertos de telemetría expuestos en el host)"]
        subgraph External_Network["2A. Red Docker externa: traefik_default (TRAEFIK_NETWORK_NAME)"]
            TRAEFIK["Traefik Reverse Proxy (Let's Encrypt TLS :443)"]
            DASH["zeromttr-dashboard (Nginx :80 + Angular SPA)"]
        end

        subgraph Internal_Network["2B. Red Docker aislada: aiops-net (solo expose:)"]
            ORCH["zeromttr-orchestrator (:8080)"]
            MCP["zeromttr-mcp-server (:8000)"]
            DEMO["zeromttr-target-demo (:3001 — api-pagamentos-core)"]
            PG[("zeromttr-postgres (:5432)")]
            OTEL["zeromttr-otel-collector (:4317 / :4318 — Transform OTTL)"]
            PROM[("zeromttr-prometheus (:9090 — 512M)")]
            LOKI[("zeromttr-loki (:3100 — 512M)")]
            TEMPO[("zeromttr-tempo (:3200 — 384M)")]
            GRAF["zeromttr-grafana (:3000)"]
        end
    end

    subgraph Cloud_APIs["3. APIs externas (HTTPS saliente)"]
        GEMINI["Google Gemini API (PII estructurada enmascarada)"]
        GITHUB["GitHub REST API (AdmilsonGoncalves/zeromttr)"]
        RESEND["Resend Email API (Enlaces HMAC exclusivos)"]
    end

    USER -->|"HTTPS (zeromttr.agjworks.com)"| CF
    CF -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"HTTP :80 (X-Accel-Buffering: no)"| DASH
    DASH -->|"Proxy /api/* + Bearer DASHBOARD_API_TOKEN"| ORCH

    ORCH <-->|"MCP Streamable HTTP (:8000 + MCP_AUTH_TOKEN)"| MCP
    ORCH -->|"Caos / Estado (:3001)"| DEMO
    ORCH <-->|"ReasoningPort (PiiPromptGuard)"| GEMINI
    GRAF -->|"POST /webhook/grafana-alert (GRAFANA_WEBHOOK_TOKEN)"| ORCH

    DEMO -->|"SQL (:5432)"| PG
    DEMO -->|"OTLP/HTTP (:4318)"| OTEL

    OTEL -->|"Remote Write + Exemplars"| PROM
    OTEL -->|"Logs (Enmascarado OTTL)"| LOKI
    OTEL -->|"Trazas (Tail Sampled)"| TEMPO

    MCP -->|"PromQL"| PROM
    MCP -->|"LogQL"| LOKI
    MCP -->|"TraceQL"| TEMPO
    MCP -->|"POST /api/annotations"| GRAF
    MCP <-->|"Diff v2.14.7...v2.14.8 y Pull Request"| GITHUB
    MCP -->|"POST /emails"| RESEND
```
