# TECH 08 — Streamlined War Room Dashboard (Phase 4b)

**Depends on:** contract defined in §3 of this document. Developed against mock server and integrated with the orchestrator ([05](./05_orchestrator.md)) at completion.
**Objective:** build a streamlined single-pane interface (**Single-Pane "War Room Dashboard"**) strictly focused on the 3-minute demo script, featuring a **Dark-First Mission Control** aesthetic (`slate-950` background, `border-slate-800` borders, and monospace typography for traces, logs, and diffs).

## 1. Streamlined Stack (Focus on the 3-Minute Critical Path)

| Item | Decision |
| :--- | :--- |
| Framework | **Angular (latest stable)** — Standalone Components, Signals, control flow `@if/@for`, `--ssr=false` |
| UI Components | **PrimeNG** (`primeng`, `@primeuix/themes` preset **Aura Dark**, `primeicons`) |
| Styling | **Tailwind CSS v4** + `tailwindcss-primeui` (`slate-950` background, `border-slate-800`) |
| Components Used | `p-selectbutton`, `p-tag`, `p-button`, `p-tabs`, `p-progressbar`, `p-knob`, `p-metergroup`, `p-toast`, `p-tooltip` (horizontal FSM bar and responsive SVG time-series charts with Tailwind/Angular Signals) |
| Internationalization (i18n) | **Modular Signal Service (`core/i18n/`)** with typed `Language` enum (`PT_BR`, `EN_US`, `ES_ES`) and dedicated **`LocaleSwitcherComponent`** dropdown (`🇧🇷 PT-BR \| 🇺🇸 EN-US \| 🇪🇸 ES-ES`) in Header |
| Mock Server | `apps/dashboard/mock-server/` (pure Node.js) emitting SSE and REST matching §3 contract |

## 2. Screen Architecture: 4 Quadrants + `/decision/:id` Route

The main route `/` (`WarRoomComponent`) displays the 4 quadrants powered by real-time SSE, while the route `/decision/:id` (`DecisionComponent`) exclusively handles HMAC-signed links opened from the Resend post-mortem email:

| Quadrant / Route | Real-Time Content |
| :--- | :--- |
| **Q1 — Top (Header, FSM Flow, KPIs, FinOps & Simulator)** | SSE status (`p-tag`), **FinOps / Payload Reduction** counter (`💰 Payload Reduction: <calculated>% (Est. ~<N>k tokens saved)`), mode switcher **`[ ⚡ Live API Mode \| 🎬 Replay Mode (Recorded) ]`** (with clear disclaimer when in public Replay mode and field for `X-Live-Demo-Key`), `LocaleSwitcherComponent` (`PT-BR / EN-US / ES-ES`), **interactive horizontal FSM Flow bar** (`0. LGTM Collect → 1. Received → 2. Investigating → 3. Enriching → 4. Remediating → 5. Opening PR → 6. Notified → 7. Resolved/Rejected` with tooltips and contextual hints), `TTD` / `TTPR` indicators, target service health status (`api-pagamentos-core`), and **`💥 Simulate Incident`** button (+ Healthy Traffic / Restore buttons and feedback via `p-toast`). |
| **Q2 — FSM Pipeline (Consolidated into Top Q1 Header)** | The incident lifecycle stages (`timelineSteps` / `fsmStages`) are displayed horizontally without scrolling in the top FSM Flow bar (`Q1`), liberating full screen width (`lg:col-span-8` + `lg:col-span-4`) for panels `Q3` and `Q4`. |
| **Q3 — Center (Live Metrics + OTel Evidences + PII Masking + Git Diff)** | `p-tabs` with 4 tabs:<br/>• **Tab 1 (Live Metrics):** Dual-scale SVG time-series charts (`p95 Latency & 5xx Error Rate`, `Throughput Req/s & Pool Usage`)<br/>• **Tab 2 (Trace Tree, Evidence Coverage, Reasoning Source & Blast Radius):** coverage bar **`Evidence Coverage: 4/4 Signals (100%)`** (or `3/4 Signals (75%)` under partial coverage), dynamic **`Reasoning Source`** badge reflecting `rca.reasoningSource` (**`Gemini LLM`** when `'llm'` or **`Deterministic Fallback`** when `'fallback'`), **Blast Radius** tags (`services_involved`), and hierarchical span tree highlighting `pg.pool.acquire` (`4.71s ERROR`)<br/>• **Tab 3 (Loki Logs & PII Masking Proof):** side-by-side comparison:<br/>&nbsp;&nbsp;🔴 **Application Reported Log (Pre-Collector):** `...payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99...`<br/>&nbsp;&nbsp;🟢 **Loki / MCP Agent Log (Post-OTTL `transform`):** `...payer CPF [REDACTED_CPF] merchant CNPJ [REDACTED_CNPJ]...`<br/>&nbsp;&nbsp;+ technical dynamic badge reflecting `rca.piiGuardAudit` (**`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`** when `passed: true`, or red alert **`Fail-Closed Triggered (<N> Leaked Patterns Blocked — Routed to Local Fallback)`** when `passed: false`)<br/>• **Tab 4 (Git Deploy Diff `v2.14.7...v2.14.8` & FinOps):** real diff extracted from `apps/target-app-demo/src/repositories/payment.repository.ts` and bounded byte/token FinOps metrics |
| **Q4 — Right (GitHub Pull Request + Resend Governance)** | Card with direct link to the **real Pull Request opened on GitHub** (`hotfix/zeromttr-*`), sanitized preview of the email dispatched by **Resend**, indicator **`🔒 Awaiting decision via HMAC link dispatched by email to on-call engineer`**, and secondary button explicitly labeled as **`[Simulation Mode] Simulate On-Call Approval`** (`POST /api/demo/simulate-decision`). |
| **Route `/decision/:id`** | Page opened upon clicking the button in the real email dispatched by Resend (`/decision/:id#action=approve\|reject&sig=<HMAC>&exp=<TS>`), reading parameters strictly from `window.location.hash` (never exposing `sig` in HTTP request logs or headers), protecting against pre-fetch email scanner bots (RFC 7231 compliance), detecting already resolved/rejected incidents with informational banners, and confirming the decision via `POST /api/incidents/:id/decision`. |

## 3. Orchestrator Contract (Single Source of Truth)

### 3.1 REST
| Method and Route | Response / Behavior |
| :--- | :--- |
| `GET /api/incidents` | `Incident[]` (summary, newest first) |
| `GET /api/incidents/:id` | `IncidentDetail` (**never** includes `decisionToken` / `sig`) |
| `POST /api/demo/chaos` | body `{ "mode": "live" \| "replay" }` (optional header `X-Live-Demo-Key`) → `202` |
| `POST /api/demo/reset` | `202` — restores target service and closes demo PRs on target repository |
| `GET /api/target/status` | `{ "status": "healthy" \| "degraded", "service": "api-pagamentos-core", "version": "v2.14.8", "previousHealthyVersion": "v2.14.7", "rawEdgeLogPreCollector"?: string }` |
| `POST /api/incidents/:id/decision` | body `{ "action": "approve" \| "reject", "sig": "<HMAC>", "exp": 1730000000 }` → `200` (used exclusively by route `/decision/:id` opened from email) |
| `POST /api/demo/simulate-decision` | body `{ "incidentId": string, "action": "approve" \| "reject" }` → `200` (used by `[Simulation Mode]` button in Q4 during replay/demo) |

### 3.2 SSE — `GET /api/events`
| Event | Payload |
| :--- | :--- |
| `incident.created` | `{ incidentId, service, severity, mode, at }` |
| `incident.transition` | `{ incidentId, from, to, at, reason? }` |
| `incident.rca` | `{ incidentId, summary, reasoningSource: 'llm' \| 'fallback', evidenceCoveragePercent, signalsCollected, signalsTotal, evidenceBreakdown, blastRadius[], diagnosisSeconds, traceId, criticalSpan, spans[], rawEdgeLogPreCollector?, logSample, piiGuardAudit: { leakedPatternsDetected: number; edgeRedactedTokensVerified: number; passed: boolean }, deployVersion?, mitigations[], grafanaAnnotationId? }` |
| `incident.finops` | `{ incidentId, rawBytesFetched, compactedBytesSent, payloadReductionPercent, estimatedTokensSaved }` |
| `incident.docs` | `{ incidentId, sources: [{ url, title, markdownExcerpt }] }` |
| `incident.remediation` | `{ incidentId, branchUrl, pullRequestUrl?, commitSha? }` |
| `incident.notified` | `{ incidentId, emailId, htmlPreview? }` (**without** `decisionToken` / `sig`) |
| `incident.decision` | `{ incidentId, action, source: 'email_hmac' \| 'demo_simulation' }` |
| `heartbeat` | `{ at }` every 15 s |

### 3.3 TypeScript Types (`apps/dashboard/src/app/core/contract.ts`)
```ts
export type IncidentState =
  | 'RECEIVED'
  | 'INVESTIGATING'
  | 'ENRICHING'
  | 'REMEDIATING'
  | 'AWAITING_PR'
  | 'NOTIFIED'
  | 'RESOLVED'
  | 'REJECTED'
  | 'FAILED';

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
}

export interface PiiGuardAudit {
  leakedPatternsDetected: number;
  detectedTypes?: string[];
  edgeRedactedTokensVerified: number;
  passed: boolean;
}

export interface Incident {
  id: string;
  service: string;
  severity: AlertSeverity | `${AlertSeverity}`;
  state: IncidentState;
  mode?: 'live' | 'replay';
  startedAt: string;
}

export interface IncidentDetail extends Incident {
  transitions: { from: IncidentState | null; to: IncidentState; at: string; reason?: string }[];
  rca?: {
    summary: string;
    reasoningSource: 'llm' | 'fallback';
    evidenceCoveragePercent: number;
    signalsCollected: number;
    signalsTotal: number;
    evidenceBreakdown?: { promql: number; exemplar: number; tempoSpan: number; lokiAndDiff: number };
    blastRadius: string[];
    diagnosisSeconds: number;
    traceId: string;
    criticalSpan: string;
    spans: SpanNode[];
    rawEdgeLogPreCollector?: string;
    logSample: string;
    piiGuardAudit: PiiGuardAudit;
    deployVersion?: string;
    mitigations: string[];
    grafanaAnnotationId?: number;
  };
  finops?: {
    rawBytesFetched: number;
    compactedBytesSent: number;
    payloadReductionPercent: number;
    estimatedTokensSaved: number;
  };
  docs?: { url: string; title: string; markdownExcerpt: string }[];
  remediation?: { branchUrl: string; pullRequestUrl?: string; commitSha?: string };
  notification?: { emailId: string; htmlPreview?: string };
  decision?: 'approve' | 'reject';
  decisionSource?: 'email_hmac' | 'demo_simulation';
}
```

## 4. Acceptance Criteria
- [ ] `ng build` and `ng test` pass; ESLint and Prettier without errors.
- [ ] `LocaleSwitcherComponent` (`🇧🇷 PT-BR | 🇺🇸 EN-US | 🇪🇸 ES-ES`) toggles fixed labels instantly without reload via `I18nService`.
- [ ] `Replay` mode displays clear warning that it is reproducing a recorded real execution, while `Live` mode triggers the real pipeline.
- [ ] Tab 1 (`Live Metrics`) displays responsive SVG time-series charts; Tab 2 displays **`Evidence Coverage: 4/4 Signals (100%)`** and **`Reasoning Source`**; Tab 3 displays OTTL masking comparison + badge **`PII Masked at Edge — Fail-Closed Guard Verified (0 Leaked Patterns)`**; Tab 4 displays diff `v2.14.7...v2.14.8` for `apps/target-app-demo` and FinOps metrics.
- [ ] No `decisionToken` or HMAC signature ever travels across SSE or `GET /api/incidents/:id`; route `/decision/:id` reads `#action=...&sig=...&exp=...` strictly from `window.location.hash` and confirms the decision via `POST`.
- [ ] When opening `/decision/:id` for an already closed incident (`RESOLVED` or `REJECTED`), an informational banner is shown and actions are disabled, avoiding false expired-token errors on HTTP 409 Conflict.
