# 📐 ZeroMTTR — Diagramas Comportamentais e Estáticos do Sistema

| Campo | Valor |
| :--- | :--- |
| **Projeto** | ZeroMTTR — Autonomous AIOps & Incident Remediation |
| **Documento Mestre** | [`00_architecture_master.md`](./00_architecture_master.md) |
| **Escopo** | Modelagem comportamental (Casos de Uso e Sequência) e estrutural/estática (Classes Hexagonais e Topologia de Rede) |

---

## 1. Diagrama de Casos de Uso

Delimita visualmente os **Atores**, a **Operação Interativa / Governança Humana (Human-in-the-Loop)**, o **Pipeline Agêntico Autônomo (Zero-Touch)** e as **Integrações Externas**.

```mermaid
flowchart TD
    subgraph Atores["1. Atores & Gatilhos"]
        SRE(["Engenheiro SRE / Plantonista"])
        GRAF(["Grafana Alerting"])
    end

    subgraph ZeroMTTR_Boundary["2. Fronteira do Sistema ZeroMTTR"]
        subgraph Operacao_Interativa["2A. War Room & Governança (Human-in-the-Loop)"]
            UC_SIM(["Simular / Restaurar Incidente (Live ou Replay)"])
            UC_MON(["Monitorar Pipeline, FinOps e Evidências via SSE"])
            UC_PII(["Auditar Redação de PII (Antes vs. Depois)"])
            UC_DEC(["Aprovar ou Rejeitar Hotfix (Assinatura HMAC)"])
        end

        subgraph Pipeline_Autonomo["2B. Pipeline Agêntico Autônomo (Zero-Touch)"]
            UC_ALT(["1. Receber e Deduplicar Alerta por Fingerprint"])
            UC_RCA(["2. Executar RCA Determinístico (PromQL + Tempo + Loki)"])
            UC_CONF(["3. Calcular RCA Confidence Score (95%) e Blast Radius"])
            UC_FIN(["4. Contabilizar Economia de Tokens (FinOps Compression)"])
            UC_DIFF(["5. Inspecionar Diff de Deploy (v2.14.7..v2.14.8) e Código no GitHub"])
            UC_ANN(["6. Injetar Anotação de Remediação no Gráfico do Grafana"])
            UC_PR(["7. Gerar Patch Cirúrgico e Abrir Pull Request hotfix/*"])
            UC_NOT(["8. Emitir Relatório Post-Mortem com Links HMAC"])
        end
    end

    subgraph Provedores_Externos["3. Integrações Externas & CI"]
        LLM(["Provedor LLM (Gemini)"])
        GH(["GitHub REST API & Repositório"])
        GHCI(["GitHub Actions (hotfix-verify.yml)"])
        RS(["Resend API (E-mail)"])
    end

    %% Ações do SRE
    SRE --> UC_SIM
    SRE --> UC_MON
    SRE --> UC_PII
    SRE --> UC_DEC

    %% Gatilho do Grafana
    GRAF --> UC_ALT

    %% Fluxo autônomo
    UC_ALT --> UC_RCA
    UC_RCA --> UC_CONF
    UC_RCA --> UC_FIN
    UC_CONF --> UC_DIFF
    UC_DIFF --> UC_ANN
    UC_DIFF --> UC_PR
    UC_PR --> UC_NOT
    UC_NOT -.->|"Habilita decisão"| UC_DEC

    %% Integrações externas
    UC_RCA <--> LLM
    UC_DIFF <--> GH
    UC_ANN --> GRAF
    UC_PR <--> LLM
    UC_PR --> GH
    GH -->|"Dispara validação do PR"| GHCI
    UC_NOT --> RS
    RS -->|"Entrega Post-Mortem"| SRE
```

---

## 2. Diagrama de Sequência Ponta a Ponta (Fluxo Comportamental)

Representa a interação cronológica completa entre os contêineres e APIs externas, incluindo o processamento assíncrono (`202 Accepted`), a correlação dos 3 pilares OTel, a inspeção do diff do deploy via GitHub API, a abertura do PR autônomo em segundos, o streaming **SSE** e a validação **HMAC** na decisão humana.

```mermaid
sequenceDiagram
    autonumber
    actor SRE as Engenheiro SRE
    participant UI as War Room Dashboard (Angular + Nginx)
    participant DEMO as target-app-demo (Express + OTel)
    participant OTEL as OTel Collector (Edge PII Redaction)
    participant LGTM as Stack LGTM (Prom/Loki/Tempo/Grafana)
    participant ORCH as Orchestrator (FSM + Agent Loop)
    participant MCP as MCP Server (8 Tools + FinOps)
    participant EXT as APIs Externas (Gemini / GitHub / Resend)

    Note over SRE,DEMO: Fase 1 — Geração da Anomalia e Redação de PII na Borda
    SRE->>UI: Clica "Simular Incidente" (POST /api/demo/chaos)
    UI->>ORCH: POST /api/demo/chaos (Bearer injetado pelo Nginx)
    ORCH->>DEMO: POST /chaos/pool-saturation?enable=true
    DEMO-->>OTEL: Emite Spans de erro, Métricas e Log bruto com CPF/JWT via OTLP/HTTP (4318)
    Note right of OTEL: Processor redaction mascara CPF/JWT ("****") antes de gravar no Loki
    OTEL->>LGTM: Persiste métricas (com exemplars), traces e logs sanitizados

    Note over LGTM,ORCH: Fase 2 — Detecção e Abertura Assíncrona do Incidente
    LGTM->>ORCH: POST /webhook/grafana-alert (Bearer WEBHOOK_TOKEN)
    ORCH->>ORCH: Valida payload (Zod), calcula fingerprint e cria Incident(RECEIVED)
    ORCH-->>LGTM: 202 Accepted (processamento segue em background)
    ORCH-->>UI: SSE event: incident.created & incident.transition (INVESTIGATING)

    Note over ORCH,MCP: Fase 3 — RCA Determinístico via MCP, FinOps e Prova de PII
    ORCH->>MCP: CallTool: execute_promql_range
    MCP->>LGTM: Consulta séries PromQL + Exemplars
    MCP-->>ORCH: Séries resumidas + trace_id + FinOps (raw vs. compacted bytes) [+25% +25% conf.]
    ORCH->>MCP: CallTool: analyze_otel_trace (trace_id)
    MCP->>LGTM: Busca árvore de Spans no Tempo
    MCP-->>ORCH: Top 5 spans lentos/erros + services_involved (Blast Radius) [+25% conf.]
    ORCH->>MCP: CallTool: query_loki_logs (trace_id)
    MCP->>LGTM: LogQL filtrado por trace_id
    MCP-->>ORCH: Logs sanitizados (CPF ****) + FinOps telemetry
    ORCH->>DEMO: GET /chaos/status (TargetStatusPort)
    DEMO-->>ORCH: status="degraded", version="v2.14.8", lastRawUnredactedLogSample

    Note over ORCH,EXT: Fase 4 — Inspeção de Deploy Diff no GitHub e Consolidação do RCA
    ORCH-->>UI: SSE event: incident.transition (ENRICHING)
    ORCH->>MCP: CallTool: inspect_git_deploy_diff (base: "v2.14.7", head: "v2.14.8", servicePath)
    MCP->>EXT: GitHub API: Compare Commits & Get File Content (truncado <= 1500 chars)
    EXT-->>MCP: Commit suspeito, diff do pool Knex e arquivo afetado
    MCP-->>ORCH: Evidência de regressão no código + FinOps telemetry [+20% conf. => Total 95%]
    ORCH-->>UI: SSE events: incident.rca (95% conf., Blast Radius, PII Antes/Depois), incident.finops, incident.docs

    Note over ORCH,EXT: Fase 5 — Anotação no Grafana e Abertura Autônoma de PR no GitHub
    ORCH-->>UI: SSE event: incident.transition (REMEDIATING)
    ORCH->>MCP: CallTool: annotate_grafana_incident (tag: aiops-remediation)
    MCP->>LGTM: POST /api/annotations
    ORCH->>EXT: ReasoningPort (Gemini): sintetiza RCA + gera patch cirúrgico do arquivo
    EXT-->>ORCH: Código corrigido (liberação de conexão no finally + ajuste de pool)
    ORCH-->>UI: SSE event: incident.transition (AWAITING_PR)
    ORCH->>MCP: CallTool: create_remediation_pr (branch: hotfix/zeromttr-*, filePath, patchedContent, rcaSummary)
    MCP->>EXT: GitHub API: cria branch, commita fix e abre Pull Request (dispara hotfix-verify.yml)
    EXT-->>MCP: pullRequestUrl + commitSha
    MCP-->>ORCH: RemediationResult (pullRequestUrl)
    ORCH-->>UI: SSE event: incident.remediation (com pullRequestUrl)

    Note over ORCH,SRE: Fase 6 — Post-Mortem (Resend) e Governança Humana (HMAC)
    ORCH->>ORCH: Gera decisionToken (approveSig, rejectSig, exp) via HMAC-SHA256
    ORCH->>MCP: CallTool: send_post_mortem_resend (HTML escapado + links /decision/:id)
    MCP->>EXT: Resend API: POST /emails (From: sre@zeromttr.agjworks.com)
    EXT-->>SRE: Entrega e-mail Post-Mortem com botões Aprovar / Rejeitar
    ORCH-->>UI: SSE event: incident.transition (NOTIFIED) & incident.notified (inclui decisionToken)

    SRE->>UI: Clica em "Aprovar Hotfix" (no Quadrante 4 ou via rota /decision/:id do e-mail)
    UI->>ORCH: POST /api/incidents/:id/decision { action: "approve", sig, exp }
    ORCH->>ORCH: Valida assinatura HMAC + expiração e transiciona FSM para RESOLVED
    ORCH->>MCP: CallTool: annotate_grafana_incident ("Incidente RESOLVED por aprovação humana")
    ORCH-->>UI: 200 OK + SSE event: incident.decision & incident.transition (RESOLVED)
```

---

## 3. Diagramas de Classes — Arquitetura Hexagonal

Como `apps/orchestrator` e `apps/mcp-server` seguem **Arquitetura Hexagonal (Ports & Adapters)** com **TDD obrigatório**, os diagramas abaixo apresentam as entidades de domínio, casos de uso, portas (interfaces) e adaptadores.

### 3.1 `apps/orchestrator` — Domínio e Ports

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
        +DecisionToken decisionToken
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
        +number confidence
        +ConfidenceBreakdown confidenceBreakdown
        +string[] blastRadius
        +number diagnosisSeconds
        +string traceId
        +string criticalSpan
        +SpanNode[] spans
        +string rawUnredactedLogSample
        +string logSample
        +string deployVersion
        +string[] mitigations
        +number grafanaAnnotationId
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
        +triggerChaos(enable: boolean) Promise~void~
    }

    Incident *-- IncidentState
    Incident *-- RcaReport
```

### 3.2 `apps/orchestrator` — Casos de Uso e Adapters

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
    class HttpTargetStatusAdapter

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
    HttpTargetStatusAdapter ..|> TargetStatusPort
```

---

### 3.3 `apps/mcp-server` — Domínio Puro, 8 Tools, Ports e Adapters HTTP

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

## 4. Diagrama Estático de Implantação e Isolamento de Rede

Ilustra a defesa em profundidade na VPS Linux: **nenhum contêiner publica portas no host (`ports:` ausente)**; apenas o contêiner `dashboard` (Nginx) participa simultaneamente da rede externa do Traefik (`traefik-public`) e da rede interna isolada (`aiops-net`), injetando internamente o cabeçalho `Authorization: Bearer ${WEBHOOK_TOKEN}` ao fazer proxy de `/api/*` para o `orchestrator`.

```mermaid
flowchart TD
    subgraph Internet["1. Internet Pública"]
        USER(["Navegador SRE / Visitante"])
        CF["Cloudflare Proxy (DNS + WAF + Bypass Cache em /api/events*)"]
    end

    subgraph VPS["2. VPS Linux (Zero Portas de Telemetria Expostas no Host)"]
        subgraph Rede_Externa["2A. Rede Docker Externa: traefik-public"]
            TRAEFIK["Traefik Reverse Proxy (TLS Let's Encrypt :443)"]
            DASH["zeromttr-dashboard (Nginx :80 + SPA Angular)"]
        end

        subgraph Rede_Interna["2B. Rede Docker Isolada: aiops-net (expose: apenas)"]
            ORCH["zeromttr-orchestrator (:8080)"]
            MCP["zeromttr-mcp-server (:8000)"]
            DEMO["zeromttr-target-demo (:3001)"]
            PG[("zeromttr-postgres (:5432)")]
            OTEL["zeromttr-otel-collector (:4317 / :4318)"]
            PROM[("zeromttr-prometheus (:9090)")]
            LOKI[("zeromttr-loki (:3100)")]
            TEMPO[("zeromttr-tempo (:3200)")]
            GRAF["zeromttr-grafana (:3000)"]
        end
    end

    subgraph Cloud_APIs["3. APIs Externas (Saída HTTPS)"]
        GEMINI["Google Gemini API"]
        GITHUB["GitHub REST API (Octokit)"]
        RESEND["Resend Email API"]
    end

    USER -->|"HTTPS (zeromttr.agjworks.com)"| CF
    CF -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"HTTP :80 (X-Accel-Buffering: no)"| DASH
    DASH -->|"Proxy /api/* + Bearer WEBHOOK_TOKEN"| ORCH

    ORCH <-->|"MCP Streamable HTTP (:8000)"| MCP
    ORCH -->|"Chaos / Status (:3001)"| DEMO
    ORCH <-->|"ReasoningPort"| GEMINI
    GRAF -->|"Webhook Alerta (:8080)"| ORCH

    DEMO -->|"SQL (:5432)"| PG
    DEMO -->|"OTLP/HTTP (:4318)"| OTEL

    OTEL -->|"Remote Write + Exemplars"| PROM
    OTEL -->|"Logs (PII Redacted)"| LOKI
    OTEL -->|"Traces (Tail Sampled)"| TEMPO

    MCP -->|"PromQL"| PROM
    MCP -->|"LogQL"| LOKI
    MCP -->|"TraceQL"| TEMPO
    MCP -->|"POST /api/annotations"| GRAF
    MCP <-->|"Diff & Pull Request"| GITHUB
    MCP -->|"POST /emails"| RESEND
```
