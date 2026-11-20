import { isFilled, isNonEmptyArray, nowIso, toErrorMessage } from '@zeromttr/utils';
import {
  IncidentEventType,
  OrchestratorDefault,
  TransitionReason
} from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import type { SpanNode } from '../domain/rca-report.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type {
  ToolsPort,
  PromqlRangeOutput,
  LokiQueryOutput,
  TraceAnalysisOutput
} from '../ports/tools.port.js';
import type { TargetStatusPort, TargetStatus } from '../ports/target-status.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

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
    private readonly broadcaster: EventBroadcasterPort,
    private readonly logger?: LoggerPort
  ) {}

  public async execute(incidentId: string): Promise<InvestigateResult> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    if (incident.state === IncidentState.RECEIVED) {
      const transition = incident.transition(
        IncidentState.INVESTIGATING,
        TransitionReason.INVESTIGATING_TELEMETRY
      );
      await this.repository.save(incident);

      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
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

    // 1. PromQL Query (TECH 09 requirement: histogram_quantile at 0.95)
    const promqlOutput = await this.tools.executePromqlRange({
      query: `histogram_quantile(0.95, sum(rate(${OrchestratorDefault.DEFAULT_METRIC}{service_name="${incident.service}"}[1m])) by (le))`,
      start: startIso,
      end: endIso,
      step: '15s'
    });

    const hasPromqlAnomaly =
      Boolean(promqlOutput) &&
      promqlOutput.seriesCount > 0 &&
      promqlOutput.summarizedSeries.some((s) => (s.p95 ?? 0) > 2000);

    let exemplarTraceId = promqlOutput.exemplarTraceId;
    const hasMetricExemplar = Boolean(exemplarTraceId);

    // 2. Trace Analysis (with TraceQL fallback if PromQL returned no exemplar)
    let traceAnalysis: TraceAnalysisOutput | undefined;
    let criticalSpan: string = OrchestratorDefault.CRITICAL_ERROR_SPAN;
    let spans: SpanNode[] = [];
    let servicesInvolved = [incident.service];
    let hasTempoErrorSpan = false;

    if (!exemplarTraceId) {
      try {
        const searchRes = await this.tools.searchTracesByTraceQL({
          query: `{resource.service.name="${incident.service}" && status=error}`,
          limit: 5,
          start: startIso,
          end: endIso
        });
        const firstHit = searchRes?.traces?.[0]?.traceId;
        if (firstHit) {
          exemplarTraceId = firstHit;
        }
      } catch {
        // Non-fatal TraceQL fallback failure
      }
    }

    if (exemplarTraceId) {
      try {
        traceAnalysis = await this.tools.analyzeOtelTrace({ trace_id: exemplarTraceId });
        servicesInvolved = traceAnalysis.servicesInvolved || servicesInvolved;
        if (isNonEmptyArray(traceAnalysis.criticalSpans)) {
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
      } catch (err) {
        hasTempoErrorSpan = false;
        this.logger?.warn({
          event: OrchestratorLogEvent.TRACE_ANALYSIS_FAILED,
          incidentId: incident.id,
          traceId: exemplarTraceId,
          message: toErrorMessage(err)
        });
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
