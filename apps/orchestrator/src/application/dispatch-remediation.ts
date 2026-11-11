import { isNonEmptyString } from '@zeromttr/utils';
import {
  IncidentState,
  PiiPromptGuard,
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
  if (!isNonEmptyString(synthesis.suspectFilePath)) {
    return false;
  }
  if (expectedSuspectPath && synthesis.suspectFilePath !== expectedSuspectPath) {
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

    // Inspect complete evidence object before LLM synthesis
    const promptToAudit = JSON.stringify(evidence);
    const piiAudit = PiiPromptGuard.inspectAndEnforceFailClosed(promptToAudit);

    let synthesis: RcaAndPatchSynthesis;
    let reasoningSource: ReasoningSource;

    if (piiAudit.passed) {
      try {
        const rawSynthesis = await this.llmAdapter.synthesizeRcaAndPatch(evidence);
        if (validatePatchDefensively(rawSynthesis, evidence.gitDiff?.suspectFilePath)) {
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
        'Enriching incident state before remediation'
      );
      this.broadcaster.broadcast('incident.transition', {
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
        'Synthesizing RCA and preparing remediation patch'
      );
      this.broadcaster.broadcast('incident.transition', {
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
    } catch {
      // Ignore non-fatal annotation failure
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
      ? evidence.traceAnalysis?.criticalOperation || 'pg.pool.acquire'
      : 'pg.pool.acquire';

    const safeSpans: SpanNode[] = piiAudit.passed
      ? [
          {
            spanId: 'span-001',
            serviceName: incident.service,
            operationName: evidence.traceAnalysis?.criticalOperation || 'pg.pool.acquire',
            durationMs: evidence.traceAnalysis?.durationMs || 4600,
            hasError: true
          }
        ]
      : [
          {
            spanId: 'span-001',
            serviceName: incident.service,
            operationName: 'pg.pool.acquire',
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
      traceId: evidence.traceAnalysis?.traceId || 'trace-unknown',
      criticalSpan: safeCriticalSpan,
      spans: safeSpans,
      logSample: piiAudit.passed
        ? evidence.logSample
        : `[RETIDO POR VIOLAÇÃO PII: ${piiAudit.detectedTypes.join(', ')}]`,
      piiGuardAudit: piiAudit,
      deployVersion: evidence.gitDiff?.headRef || 'v2.14.8',
      mitigations: [
        'Restaurar o bloco finally { client.release(); }',
        'Restaurar o dimensionamento do pool para max: 10'
      ],
      grafanaAnnotationId: annotationId
    };

    incident.rca = rcaReport;

    this.broadcaster.broadcast('incident.rca', {
      incidentId: incident.id,
      ...rcaReport
    });

    // Transition to AWAITING_PR
    if (incident.state === IncidentState.REMEDIATING) {
      const transitionAwaiting = incident.transition(
        IncidentState.AWAITING_PR,
        'Opening remediation Pull Request on GitHub'
      );
      this.broadcaster.broadcast('incident.transition', {
        incidentId: incident.id,
        from: transitionAwaiting.from,
        to: transitionAwaiting.to,
        at: transitionAwaiting.at,
        reason: transitionAwaiting.reason
      });
    }

    // Create Remediation PR
    const prResult = await this.tools.createRemediationPr({
      incident_id: incident.id,
      file_path: synthesis.suspectFilePath,
      patched_content: synthesis.patchedContent,
      blob_sha: blobSha,
      title: `fix(target-app-demo): release db client in finally block and restore pool size [incident ${incident.id}]`,
      rca_markdown: `## Root Cause Analysis\n\n${synthesis.rootCause}\n\n**Reasoning Source:** \`${reasoningSource}\`\n\n${synthesis.explanation}`,
      reasoning_source: reasoningSource
    });

    incident.remediation = {
      ...prResult,
      suspectCommitSha: evidence.gitDiff?.suspectCommit
    };
    await this.repository.save(incident);

    this.broadcaster.broadcast('incident.remediation', {
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
