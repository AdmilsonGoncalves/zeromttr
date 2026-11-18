import { isNonEmptyString } from '@zeromttr/utils';
import {
  IncidentEventType,
  IncidentState,
  OrchestratorDefault,
  PiiPromptGuard,
  TransitionReason,
  calculateEvidenceCoverage,
  type RcaReport,
  type ReasoningSource,
  type SpanNode
} from '../domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  ReasoningPort,
  EventBroadcasterPort,
  CollectedEvidence,
  RcaAndPatchSynthesis,
  CreateRemediationPrOutput
} from '../ports/index.js';

export interface DispatchRemediationResult {
  rcaReport: RcaReport;
  prResult: CreateRemediationPrOutput;
  reasoningSource: ReasoningSource;
}

function validatePatchDefensively(
  synthesis: RcaAndPatchSynthesis,
  expectedSuspectPath?: string
): boolean {
  if (!isNonEmptyString(expectedSuspectPath) || !isNonEmptyString(synthesis.suspectFilePath)) {
    return false;
  }
  if (synthesis.suspectFilePath !== expectedSuspectPath) {
    return false;
  }
  const content = synthesis.patchedContent;
  if (!isNonEmptyString(content) || content.trim().length === 0) {
    return false;
  }
  return true;
}

export class DispatchRemediation {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly llmAdapter: ReasoningPort,
    private readonly fallbackAdapter: ReasoningPort,
    private readonly broadcaster: EventBroadcasterPort
  ) {}

  public async execute(
    incidentId: string,
    evidence: CollectedEvidence,
    blobSha?: string
  ): Promise<DispatchRemediationResult> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    const authoritativeSuspectPath = evidence.gitDiff?.suspectFilePath;
    if (!isNonEmptyString(authoritativeSuspectPath)) {
      throw new Error('Cannot create remediation PR without an authoritative suspectFilePath');
    }

    // Inspect complete evidence object before LLM synthesis
    const promptToAudit = JSON.stringify(evidence);
    const piiAudit = PiiPromptGuard.inspectAndEnforceFailClosed(promptToAudit);

    let synthesis: RcaAndPatchSynthesis;
    let reasoningSource: ReasoningSource;

    if (piiAudit.passed) {
      try {
        const rawSynthesis = await this.llmAdapter.synthesizeRcaAndPatch(evidence);
        if (validatePatchDefensively(rawSynthesis, authoritativeSuspectPath)) {
          synthesis = rawSynthesis;
          reasoningSource = 'llm';
        } else {
          synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
          reasoningSource = 'fallback';
        }
      } catch {
        synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
        reasoningSource = 'fallback';
      }
    } else {
      // Fail-closed! Route directly to fallback
      synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
      reasoningSource = 'fallback';
    }

    // Ensure valid lifecycle transitions before REMEDIATING
    if (incident.state === IncidentState.INVESTIGATING) {
      const transitionEnriching = incident.transition(
        IncidentState.ENRICHING,
        TransitionReason.ENRICHING_BEFORE_REMEDIATION
      );
      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transitionEnriching.from,
        to: transitionEnriching.to,
        at: transitionEnriching.at,
        reason: transitionEnriching.reason
      });
    }

    if (incident.state === IncidentState.ENRICHING) {
      const transitionRemediating = incident.transition(
        IncidentState.REMEDIATING,
        TransitionReason.REMEDIATING_SYNTHESIS
      );
      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transitionRemediating.from,
        to: transitionRemediating.to,
        at: transitionRemediating.at,
        reason: transitionRemediating.reason
      });
    }

    // Annotate Grafana
    let annotationId: number | undefined;
    try {
      const annRes = await this.tools.annotateGrafanaIncident({
        time: Date.now(),
        text: `[REMEDIATING] Incident ${incident.id}: ${synthesis.summary}`,
        tags: ['aiops-remediation']
      });
      annotationId = annRes.annotationId;
    } catch (err) {
      // Ignore non-fatal annotation failure
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'grafana_annotation_failed',
          incidentId: incident.id,
          message: err instanceof Error ? err.message : String(err)
        })
      );
    }

    // Evidence coverage calculation using actual collected signals
    const hasPromqlAnomaly =
      evidence.signals?.hasPromqlAnomaly ??
      Boolean(
        evidence.promqlSummary &&
        ((evidence.promqlSummary.p95LatencyMs ?? 0) > 2000 ||
          (evidence.promqlSummary.dbPoolWaiting ?? 0) > 0)
      );
    const hasMetricExemplar =
      evidence.signals?.hasMetricExemplar ?? Boolean(evidence.traceAnalysis?.traceId);
    const hasTempoErrorSpan =
      evidence.signals?.hasTempoErrorSpan ??
      Boolean(evidence.traceAnalysis?.errorMessage || evidence.traceAnalysis?.criticalOperation);
    const hasLokiLogAndGitDiff =
      evidence.signals?.hasLokiLogAndGitDiff ??
      Boolean(evidence.gitDiff?.patch && evidence.logSample);

    const coverage = calculateEvidenceCoverage({
      hasPromqlAnomaly,
      hasMetricExemplar,
      hasTempoErrorSpan,
      hasLokiLogAndGitDiff
    });

    const safeCriticalSpan = piiAudit.passed
      ? evidence.traceAnalysis?.criticalOperation || OrchestratorDefault.CRITICAL_ERROR_SPAN
      : OrchestratorDefault.CRITICAL_ERROR_SPAN;

    const safeSpans: SpanNode[] = piiAudit.passed
      ? [
          {
            spanId: 'span-001',
            serviceName: incident.service,
            operationName:
              evidence.traceAnalysis?.criticalOperation || OrchestratorDefault.CRITICAL_ERROR_SPAN,
            durationMs: evidence.traceAnalysis?.durationMs || 4600,
            hasError: true
          }
        ]
      : [
          {
            spanId: 'span-001',
            serviceName: incident.service,
            operationName: OrchestratorDefault.CRITICAL_ERROR_SPAN,
            durationMs: 4600,
            hasError: true
          }
        ];

    const safeBlastRadius = piiAudit.passed
      ? evidence.traceAnalysis?.servicesInvolved || [incident.service]
      : [incident.service];

    const rcaReport: RcaReport = {
      summary: synthesis.summary,
      rootCause: synthesis.rootCause,
      reasoningSource,
      evidenceCoveragePercent: coverage.score,
      signalsCollected: coverage.signalsCollected,
      signalsTotal: coverage.signalsTotal,
      evidenceBreakdown: coverage.breakdown,
      blastRadius: safeBlastRadius,
      diagnosisSeconds: 4,
      traceId: evidence.traceAnalysis?.traceId || OrchestratorDefault.UNKNOWN_TRACE_ID,
      criticalSpan: safeCriticalSpan,
      spans: safeSpans,
      logSample: piiAudit.passed
        ? evidence.logSample
        : `[WITHHELD DUE TO PII VIOLATION: ${piiAudit.detectedTypes.join(', ')}]`,
      piiGuardAudit: piiAudit,
      deployVersion: evidence.gitDiff?.headRef || OrchestratorDefault.UNKNOWN,
      mitigations: [synthesis.explanation || synthesis.rootCause],
      grafanaAnnotationId: annotationId
    };

    incident.rca = rcaReport;

    this.broadcaster.broadcast(IncidentEventType.RCA, {
      incidentId: incident.id,
      ...rcaReport
    });

    // Transition to AWAITING_PR
    if (incident.state === IncidentState.REMEDIATING) {
      const transitionAwaiting = incident.transition(
        IncidentState.AWAITING_PR,
        TransitionReason.AWAITING_PR
      );
      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transitionAwaiting.from,
        to: transitionAwaiting.to,
        at: transitionAwaiting.at,
        reason: transitionAwaiting.reason
      });
    }

    // Create Remediation PR
    const prTitleSummary = synthesis.summary.replace(/\s+/g, ' ').trim().slice(0, 72);
    const prResult = await this.tools.createRemediationPr({
      incident_id: incident.id,
      file_path: synthesis.suspectFilePath,
      patched_content: synthesis.patchedContent,
      blob_sha: blobSha,
      title: `fix(${incident.service}): ${prTitleSummary || OrchestratorDefault.PR_TITLE_FALLBACK} [incident ${incident.id}]`,
      rca_markdown: `## Root Cause Analysis\n\n${synthesis.rootCause}\n\n**Reasoning Source:** \`${reasoningSource}\`\n\n${synthesis.explanation}`,
      reasoning_source: reasoningSource
    });

    incident.remediation = {
      ...prResult,
      suspectCommitSha: evidence.gitDiff?.suspectCommit
    };
    await this.repository.save(incident);

    this.broadcaster.broadcast(IncidentEventType.REMEDIATION, {
      incidentId: incident.id,
      ...prResult
    });

    return {
      rcaReport,
      prResult,
      reasoningSource
    };
  }
}
