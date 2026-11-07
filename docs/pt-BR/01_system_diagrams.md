# 📐 ZeroMTTR — Diagramas Comportamentais e Estáticos do Sistema

| Campo | Valor |
| :--- | :--- |
| **Projeto** | ZeroMTTR — Autonomous AIOps & Incident Remediation |
| **Trilha** | Logística & Automação (Automação de fluxos de trabalho operacionais e integrações entre sistemas) |
| **Documento Mestre** | [`00_architecture_master.md`](./00_architecture_master.md) |
| **Escopo** | Modelagem comportamental (Casos de Uso e Sequência) e estrutural/estática (Classes Hexagonais e Topologia de Rede) |

---

## 1. Diagrama de Casos de Uso

Delimita visualmente os **Atores** (incluindo clientes MCP externos como Cursor / Claude Desktop / MCP Inspector), a **Operação Interativa / Governança Humana (Human-in-the-Loop)**, o **Pipeline Agêntico Autônomo (Zero-Touch)** e as **Integrações Externas**.

```mermaid
flowchart TD
    subgraph Atores["1. Atores, Clientes MCP & Gatilhos"]
        SRE(["Engenheiro SRE / Plantonista"])
        EXT_MCP(["Cliente MCP Externo (Cursor / Claude / Inspector)"])
        GRAF(["Grafana Alerting"])
    end

    subgraph ZeroMTTR_Boundary["2. Fronteira do Sistema ZeroMTTR"]
        subgraph Operacao_Interativa["2A. War Room & Governança (Human-in-the-Loop)"]
            UC_SIM(["Simular / Restaurar Incidente (Live c/ Chave ou Replay Público)"])
            UC_MON(["Monitorar Pipeline, FinOps e Evidências via SSE"])
            UC_PII(["Auditar Mascaramento de PII (OTTL Transform + PiiPromptGuard)"])
            UC_DEC(["Aprovar ou Rejeitar Hotfix (Via Link HMAC Exclusivo do E-mail)"])
            UC_EXT(["Explorar as 8 Tools de AIOps via Contrato MCP Aberto (.mcp.json)"])
        end

        subgraph Pipeline_Autonomo["2B. Pipeline Agêntico Autônomo (Zero-Touch)"]
            UC_ALT(["1. Receber e Deduplicar Alerta por Fingerprint"])
            UC_RCA(["2. Executar RCA via MCP (PromQL + Tempo + Loki Sanitizado)"])
            UC_COV(["3. Calcular Evidence Coverage (0-4 Sinais) e Blast Radius"])
            UC_FIN(["4. Contabilizar Economia de Tokens (FinOps Compression)"])
            UC_DIFF(["5. Inspecionar Diff Real (v2.14.7..v2.14.8) no Repo Alvo"])
            UC_GUARD(["6. Auditar Prompt com PiiPromptGuard (0 Padrões PII)"])
            UC_ANN(["7. Injetar Anotação de Remediação no Gráfico do Grafana"])
            UC_PR(["8. Gerar Patch Cirúrgico e Abrir PR no Repo Alvo (hotfix/*)"])
            UC_NOT(["9. Emitir Post-Mortem com Links HMAC Exclusivos por E-mail"])
        end
    end

    subgraph Provedores_Externos["3. Integrações Externas & Repositório Alvo"]
        LLM(["Provedor LLM (Gemini API)"])
        GH(["GitHub API & Repo Alvo (zeromttr-target-demo)"])
        GHCI(["GitHub Actions no Repo Alvo (hotfix-verify.yml)"])
        RS(["Resend API (E-mail ao Plantonista)"])
    end

    %% Ações do SRE e Cliente MCP Externo
    SRE --> UC_SIM
    SRE --> UC_MON
    SRE --> UC_PII
    SRE --> UC_DEC
    EXT_MCP --> UC_EXT

    %% Gatilho do Grafana
    GRAF --> UC_ALT

    %% Fluxo autônomo
    UC_ALT --> UC_RCA
    UC_RCA --> UC_COV
    UC_RCA --> UC_FIN
    UC_COV --> UC_DIFF
    UC_DIFF --> UC_GUARD
    UC_GUARD --> UC_ANN
    UC_GUARD --> UC_PR
    UC_PR --> UC_NOT

    %% Integrações externas
    UC_RCA <--> LLM
    UC_DIFF <--> GH
    UC_ANN --> GRAF
    UC_PR <--> LLM
    UC_PR --> GH
    GH -->|"Dispara validação do PR"| GHCI
    UC_NOT --> RS
    RS -->|"Entrega link HMAC exclusivo"| SRE
    SRE -.->|"Clica no link do e-mail"| UC_DEC
```

---

## 2. Diagrama de Sequência Ponta a Ponta (Fluxo Comportamental)

Representa a interação cronológica completa entre os contêineres e APIs externas, destacando:
1. O mascaramento de PII no corpo do log (`transform` OTTL no Collector) **antes** do armazenamento no Loki;
2. A validação determinística pelo **`PiiPromptGuard`** **antes** de enviar o prompt ao Gemini;
3. A inspeção das tags reais `v2.14.7...v2.14.8` e abertura do PR no repositório-alvo separado (`zeromttr-target-demo`);
4. A segregação entre `GRAFANA_WEBHOOK_TOKEN` e `DASHBOARD_API_TOKEN`, mantendo o **`decisionToken` HMAC restrito exclusivamente ao e-mail enviado pelo Resend** (nunca exposto no SSE ou em `GET /api/incidents/:id`).

```mermaid
sequenceDiagram
    autonumber
    actor SRE as Engenheiro SRE
    participant UI as War Room Dashboard (Angular + Nginx)
    participant DEMO as target-app-demo (api-pagamentos-core)
    participant OTEL as OTel Collector (OTTL Transform PII Masking)
    participant LGTM as Stack LGTM (Prom/Loki/Tempo/Grafana)
    participant ORCH as Orchestrator (FSM + PiiPromptGuard)
    participant MCP as MCP Server (8 Tools + FinOps)
    participant EXT as APIs Externas (Gemini / GitHub Repo Alvo / Resend)

    Note over SRE,DEMO: Fase 1 — Geração da Anomalia e Mascaramento OTTL na Borda
    SRE->>UI: Clica "Simular Incidente" (POST /api/demo/chaos)
    UI->>ORCH: POST /api/demo/chaos (Bearer DASHBOARD_API_TOKEN + X-Live-Demo-Key)
    ORCH->>DEMO: POST /chaos/pool-saturation?enable=true
    DEMO-->>OTEL: Emite Spans de erro, Métricas e Log com CPF/CNPJ/Chave PIX/JWT via OTLP (4318)
    Note right of OTEL: Processor transform (OTTL replace_pattern) mascara CPF/CNPJ/PIX/JWT em log.body e atributos
    OTEL->>LGTM: Persiste métricas (com exemplars), traces e logs já mascarados ([REDACTED_CPF], [REDACTED_JWT])

    Note over LGTM,ORCH: Fase 2 — Detecção e Abertura Assíncrona do Incidente
    LGTM->>ORCH: POST /webhook/grafana-alert (Bearer GRAFANA_WEBHOOK_TOKEN)
    ORCH->>ORCH: Valida payload (Zod), calcula fingerprint e cria Incident(RECEIVED)
    ORCH-->>LGTM: 202 Accepted (processamento segue em background)
    ORCH-->>UI: SSE event: incident.created & incident.transition (INVESTIGATING)

    Note over ORCH,MCP: Fase 3 — Coleta OTel via MCP, FinOps e Evidence Coverage
    ORCH->>MCP: CallTool: execute_promql_range
    MCP->>LGTM: Consulta séries PromQL + Exemplars
    MCP-->>ORCH: Séries resumidas + trace_id + FinOps (raw vs. compacted bytes) [Sinais 1/4 e 2/4 = 50%]
    ORCH->>MCP: CallTool: analyze_otel_trace (trace_id)
    MCP->>LGTM: Busca árvore de Spans no Tempo
    MCP-->>ORCH: Top 5 spans lentos/erros + services_involved (Blast Radius) [Sinal 3/4 = 75%]
    ORCH->>MCP: CallTool: query_loki_logs (trace_id)
    MCP->>LGTM: LogQL filtrado por trace_id
    MCP-->>ORCH: Logs mascarados ([REDACTED_CPF]) + FinOps telemetry
    ORCH->>DEMO: GET /chaos/status (TargetStatusPort)
    DEMO-->>ORCH: status="degraded", version="v2.14.8", previousHealthyVersion="v2.14.7"

    Note over ORCH,EXT: Fase 4 — Diff Real (v2.14.7..v2.14.8) no Repo Alvo e Auditoria PiiPromptGuard
    ORCH-->>UI: SSE event: incident.transition (ENRICHING)
    ORCH->>MCP: CallTool: inspect_git_deploy_diff (base: "v2.14.7", head: "v2.14.8")
    MCP->>EXT: GitHub API (zeromttr-target-demo): Compare v2.14.7...v2.14.8 & Get File Content
    EXT-->>MCP: Commit de regressão, diff real do PaymentRepository.ts e blob sha
    MCP-->>ORCH: Diff truncado (<= 1500 chars) + FinOps telemetry [Sinal 4/4 = 95% (4/4 Signals)]
    ORCH->>ORCH: PiiPromptGuard.inspect(prompt): confirma piiPatternsDetectedInPrompt === 0
    ORCH-->>UI: SSE events: incident.rca (Evidence 4/4, Blast Radius, PiiGuardAudit), incident.finops, incident.docs

    Note over ORCH,EXT: Fase 5 — Síntese de Patch, Anotação no Grafana e PR no Repositório Alvo
    ORCH-->>UI: SSE event: incident.transition (REMEDIATING)
    ORCH->>MCP: CallTool: annotate_grafana_incident (tag: aiops-remediation)
    MCP->>LGTM: POST /api/annotations
    ORCH->>EXT: ReasoningPort (Gemini): sintetiza RCA + gera patch cirúrgico (fallback determinístico se falhar)
    EXT-->>ORCH: Código corrigido (restaura finally { client.release() } e pool max: 10)
    ORCH-->>UI: SSE event: incident.transition (AWAITING_PR)
    ORCH->>MCP: CallTool: create_remediation_pr (branch: hotfix/zeromttr-*, filePath, patchedContent, blobSha)
    MCP->>EXT: GitHub API (zeromttr-target-demo): cria branch, commita fix e abre Pull Request
    EXT-->>MCP: branchUrl + pullRequestUrl + commitSha (dispara hotfix-verify.yml no repo-alvo)
    MCP-->>ORCH: RemediationPrReceipt
    ORCH-->>UI: SSE event: incident.remediation (branchUrl, pullRequestUrl, commitSha)

    Note over ORCH,SRE: Fase 6 — Post-Mortem (Resend) com HMAC Exclusivo no E-mail
    ORCH->>ORCH: Gera approveSig, rejectSig e exp via HMAC-SHA256 (NÃO persistidos na API pública nem no SSE)
    ORCH->>MCP: CallTool: send_post_mortem_resend (HTML escapado + links /decision/:id?action=...&sig=...&exp=...)
    MCP->>EXT: Resend API: POST /emails (From: sre@zeromttr.agjworks.com)
    EXT-->>SRE: Entrega e-mail Post-Mortem com botões Aprovar / Rejeitar assinados
    ORCH-->>UI: SSE event: incident.transition (NOTIFIED) & incident.notified (apenas emailId e htmlPreview sanitizado, SEM sig)

    SRE->>UI: Abre link do e-mail (/decision/:id?action=approve&sig=...&exp=...) e confirma
    UI->>ORCH: POST /api/incidents/:id/decision { action: "approve", sig, exp }
    ORCH->>ORCH: Valida assinatura HMAC + expiração e transiciona FSM para RESOLVED
    ORCH->>MCP: CallTool: annotate_grafana_incident ("Incidente RESOLVED por aprovação humana")
    ORCH-->>UI: 200 OK + SSE event: incident.decision & incident.transition (RESOLVED)
```

---

## 3. Diagramas de Classes — Arquitetura Hexagonal

Como `apps/orchestrator` e `apps/mcp-server` seguem **Arquitetura Hexagonal (Ports & Adapters)** com **TDD obrigatório**, os diagramas abaixo apresentam as entidades de domínio (incluindo `PiiPromptGuard` e `EvidenceCoverage`), casos de uso, portas (interfaces) e adaptadores.

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
        +inspectAndAssertSafe(promptText: string)$ PiiGuardAudit
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
    RcaReport ..> PiiPromptGuard
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
    class DeterministicFallbackReasoningAdapter
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
    DeterministicFallbackReasoningAdapter ..|> ReasoningPort
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

Ilustra a defesa em profundidade na VPS Linux:
- **Nenhum contêiner publica portas no host (`ports:` ausente)**;
- Apenas o contêiner `dashboard` (Nginx) participa simultaneamente da rede externa do Traefik (`traefik-public`) e da rede interna isolada (`aiops-net`);
- **Segregação estrita de credenciais:** o Nginx injeta `Authorization: Bearer ${DASHBOARD_API_TOKEN}` nas rotas `/api/*` do Dashboard, enquanto o Grafana Alerting utiliza um token exclusivo (`GRAFANA_WEBHOOK_TOKEN`) para acionar `POST /webhook/grafana-alert` internamente na rede `aiops-net`.

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
            DEMO["zeromttr-target-demo (:3001 — api-pagamentos-core)"]
            PG[("zeromttr-postgres (:5432)")]
            OTEL["zeromttr-otel-collector (:4317 / :4318 — OTTL Transform)"]
            PROM[("zeromttr-prometheus (:9090 — 512M)")]
            LOKI[("zeromttr-loki (:3100 — 512M)")]
            TEMPO[("zeromttr-tempo (:3200 — 384M)")]
            GRAF["zeromttr-grafana (:3000)"]
        end
    end

    subgraph Cloud_APIs["3. APIs Externas & Repositório Alvo (Saída HTTPS)"]
        GEMINI["Google Gemini API (0 PII)"]
        GITHUB["GitHub REST API (zeromttr-target-demo)"]
        RESEND["Resend Email API (Links HMAC Exclusivos)"]
    end

    USER -->|"HTTPS (zeromttr.agjworks.com)"| CF
    CF -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"HTTP :80 (X-Accel-Buffering: no)"| DASH
    DASH -->|"Proxy /api/* + Bearer DASHBOARD_API_TOKEN"| ORCH

    ORCH <-->|"MCP Streamable HTTP (:8000 + MCP_AUTH_TOKEN)"| MCP
    ORCH -->|"Chaos / Status (:3001)"| DEMO
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
    MCP <-->|"Diff v2.14.7..v2.14.8 & Pull Request"| GITHUB
    MCP -->|"POST /emails"| RESEND
```
