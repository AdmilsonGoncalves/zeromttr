import { isFilled, nowIso } from '@zeromttr/utils';
import { IncidentState, type SpanNode } from '../domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  TargetStatusPort,
  EventBroadcasterPort,
  TargetStatus,
  PromqlRangeOutput,
  LokiQueryOutput,
  TraceAnalysisOutput
} from '../ports/index.js';

export interface InvestigateResult {
  incidentId: string;
  promqlOutput: PromqlRangeOutput;
  traceId?: string;
  traceAnalysis?: TraceAnalysisOutput;
  criticalSpan: string;
  spans: SpanNode[];
  servicesInvolved: string[];
  lokiOutput: LokiQueryOutput;
  logSample: string;
  targetStatus: TargetStatus;
  hasPromqlAnomaly: boolean;
  hasMetricExemplar: boolean;
  hasTempoErrorSpan: boolean;
}

export class InvestigateIncident {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly targetStatusPort: TargetStatusPort,
    private readonly broadcaster: EventBroadcasterPort
  ) {}

  public async execute(incidentId: string): Promise<InvestigateResult> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    if (incident.state === IncidentState.RECEIVED) {
      const transition = incident.transition(
        IncidentState.INVESTIGATING,
        'Commencing telemetry investigation'
      );
      await this.repository.save(incident);

      this.broadcaster.broadcast('incident.transition', {
        incidentId: incident.id,
        from: transition.from,
        to: transition.to,
        at: transition.at,
        reason: transition.reason
      });
    }

    const nowMs = Date.now();
    const startIso = new Date(nowMs - 5 * 60 * 1000).toISOString();
    const endIso = nowIso();

    // 1. PromQL Query
    const promqlOutput = await this.tools.executePromqlRange({
      query: `sum(rate(http_server_duration_milliseconds_bucket{service_name="${incident.service}"}[1m])) by (le)`,
      start: startIso,
      end: endIso,
      step: '15s'
    });

    const hasPromqlAnomaly =
      Boolean(promqlOutput) &&
      promqlOutput.seriesCount > 0 &&
      promqlOutput.summarizedSeries.some((s) => (s.p95 ?? 0) > 2000);

    const exemplarTraceId = promqlOutput.exemplarTraceId;
    const hasMetricExemplar = Boolean(exemplarTraceId);

    // 2. Trace Analysis
    let traceAnalysis: TraceAnalysisOutput | undefined;
    let criticalSpan = 'pg.pool.acquire';
    let spans: SpanNode[] = [];
    let servicesInvolved = [incident.service, 'postgres'];
    let hasTempoErrorSpan = false;

    if (exemplarTraceId) {
      try {
        traceAnalysis = await this.tools.analyzeOtelTrace({ trace_id: exemplarTraceId });
        servicesInvolved = traceAnalysis.servicesInvolved || servicesInvolved;
        if (traceAnalysis.criticalSpans && traceAnalysis.criticalSpans.length > 0) {
          spans = traceAnalysis.criticalSpans.map((cs) => ({
            spanId: cs.spanId,
            parentSpanId: cs.parentSpanId,
            serviceName: cs.serviceName,
            operationName: cs.operationName,
            durationMs: cs.durationMs,
            hasError: cs.hasError,
            errorMessage: cs.errorMessage
          }));
          const errSpan = spans.find((s) => s.hasError);
          if (errSpan) {
            criticalSpan = errSpan.operationName;
            hasTempoErrorSpan = true;
          } else {
            criticalSpan = spans[0].operationName;
          }
        }
      } catch {
        hasTempoErrorSpan = false;
      }
    }

    // 3. Loki Logs
    const lokiOutput = await this.tools.queryLokiLogs({
      logql: `{service="${incident.service}"}`,
      start: startIso,
      end: endIso,
      limit: 20
    });

    const logSample = isFilled(lokiOutput.logs)
      ? lokiOutput.logs.map((l) => l.line).join('\n')
      : '';

    // 4. Target Status
    const targetStatus = await this.targetStatusPort.getStatus();

    return {
      incidentId: incident.id,
      promqlOutput,
      traceId: exemplarTraceId,
      traceAnalysis,
      criticalSpan,
      spans,
      servicesInvolved,
      lokiOutput,
      logSample,
      targetStatus,
      hasPromqlAnomaly,
      hasMetricExemplar,
      hasTempoErrorSpan
    };
  }
}
