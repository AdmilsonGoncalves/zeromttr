import {
  diffInSeconds,
  isNonEmptyString,
  nowIso,
  round,
  sanitizeWhitespace,
  toErrorMessage,
  truncate
} from '@zeromttr/utils';
import {
  GrafanaAnnotationTag,
  IncidentEventType,
  OrchestratorDefault,
  ReasoningProvider,
  TransitionReason
} from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import { PiiPromptGuard } from '../domain/pii-prompt-guard.js';
import { calculateEvidenceCoverage } from '../domain/evidence-coverage.js';
import type { RcaReport, ReasoningSource, SpanNode } from '../domain/rca-report.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { CreateRemediationPrOutput, ToolsPort } from '../ports/tools.port.js';
import type {
  CollectedEvidence,
  PatchSyntaxValidatorPort,
  RcaAndPatchSynthesis,
  ReasoningPort
} from '../ports/reasoning.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export interface DispatchRemediationResult {
  rcaReport: RcaReport;
  prResult: CreateRemediationPrOutput;
  reasoningSource: ReasoningSource;
}

export interface DispatchRemediationOptions {
  syntaxValidator?: PatchSyntaxValidatorPort;
  requiredContentPatterns?: RegExp[];
}

const TRUNCATED_PATCH_PLACEHOLDER_PATTERN =
  /(?:\/\/|\/\*)\s*\.\.\.|keep all original|rest of (?:the )?(?:file|class|code)/i;

function isTruncatedLlmSnippet(content: string): boolean {
  return TRUNCATED_PATCH_PLACEHOLDER_PATTERN.test(content);
}

function extractRequiredExportPatterns(suspectFileContent?: string): RegExp[] {
  if (!isNonEmptyString(suspectFileContent)) {
    return [];
  }
  const patterns: RegExp[] = [];
  const seen = new Set<string>();
  const exportRegex =
    /\bexport\s+(?:async\s+)?(?:class|const|let|function|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const match of suspectFileContent.matchAll(exportRegex)) {
    const symbolName = match[1];
    if (symbolName && !seen.has(symbolName)) {
      seen.add(symbolName);
      const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(
        new RegExp(
          `\\bexport\\s+(?:async\\s+)?(?:class|const|let|function|interface|type|enum)\\s+${escapedSymbol}(?![A-Za-z0-9_$])`
        )
      );
    }
  }
  return patterns;
}

function validatePatchDefensively(
  synthesis: RcaAndPatchSynthesis,
  expectedSuspectPath?: string,
  options: DispatchRemediationOptions = {},
  suspectFileContent?: string
): boolean {
  if (!isNonEmptyString(expectedSuspectPath) || !isNonEmptyString(synthesis.suspectFilePath)) {
    return false;
  }
  if (synthesis.suspectFilePath !== expectedSuspectPath) {
    return false;
  }
  const content = synthesis.patchedContent;
  if (!isNonEmptyString(content)) {
    return false;
  }
  if (
    options.syntaxValidator &&
    !options.syntaxValidator.isValidSyntax(synthesis.suspectFilePath, content)
  ) {
    return false;
  }
  const requiredPatterns = [
    ...(options.requiredContentPatterns ?? []),
    ...extractRequiredExportPatterns(suspectFileContent)
  ];
  for (const pattern of requiredPatterns) {
    if (pattern.global || pattern.sticky) {
      pattern.lastIndex = 0;
    }
    if (!pattern.test(content)) {
      return false;
    }
  }
  return true;
}

/**
 * Use case enforcing fail-closed PII checks, LLM/fallback synthesis, patch validation, and PR creation.
 */
export class DispatchRemediation {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly llmAdapter: ReasoningPort,
    private readonly fallbackAdapter: ReasoningPort,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly logger?: LoggerPort,
    private readonly options: DispatchRemediationOptions = {}
  ) {}

  /**
   * Enforces PII guardrails, synthesizes RCA/patch, opens the remediation PR, and persists state.
   */
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

    // Ensure valid lifecycle transitions to REMEDIATING before synthesis so UI and TTD reflect start of remediation
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

    // Inspect complete evidence object before LLM synthesis
    const promptToAudit = JSON.stringify(evidence);
    const piiAudit = PiiPromptGuard.inspectAndEnforceFailClosed(promptToAudit);

    let synthesis: RcaAndPatchSynthesis;
    let reasoningSource: ReasoningSource;

    const suspectFileContent = evidence.gitDiff?.suspectFileContent;
    if (piiAudit.passed) {
      try {
        const rawSynthesis = await this.llmAdapter.synthesizeRcaAndPatch(evidence);
        if (
          isNonEmptyString(rawSynthesis.patchedContent) &&
          !isTruncatedLlmSnippet(rawSynthesis.patchedContent) &&
          validatePatchDefensively(
            rawSynthesis,
            authoritativeSuspectPath,
            this.options,
            suspectFileContent
          )
        ) {
          synthesis = rawSynthesis;
          reasoningSource = ReasoningProvider.LLM;
        } else {
          synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
          reasoningSource = ReasoningProvider.FALLBACK;
        }
      } catch {
        synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
        reasoningSource = ReasoningProvider.FALLBACK;
      }
    } else {
      // Fail-closed! Route directly to fallback
      synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
      reasoningSource = ReasoningProvider.FALLBACK;
    }

    if (
      reasoningSource === ReasoningProvider.FALLBACK &&
      !validatePatchDefensively(
        synthesis,
        authoritativeSuspectPath,
        this.options,
        suspectFileContent
      )
    ) {
      throw new Error('Fallback remediation patch failed defensive validation');
    }

    // Annotate Grafana
    let annotationId: number | undefined;
    try {
      const annRes = await this.tools.annotateGrafanaIncident({
        time: Date.now(),
        text: `[REMEDIATING] Incident ${incident.id}: ${synthesis.summary}`,
        tags: [GrafanaAnnotationTag.REMEDIATION]
      });
      annotationId = annRes.annotationId;
    } catch (err) {
      // Ignore non-fatal annotation failure
      this.logger?.warn({
        event: OrchestratorLogEvent.GRAFANA_ANNOTATION_FAILED,
        incidentId: incident.id,
        message: toErrorMessage(err)
      });
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
      diagnosisSeconds: Math.max(0, round(diffInSeconds(incident.startedAt, nowIso()), 1)),
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

    // Re-check persisted state right before opening an external PR (e.g. if operator reset raced)
    const persistedIncident = await this.repository.findById(incidentId);
    if (
      !persistedIncident ||
      persistedIncident.state === IncidentState.FAILED ||
      persistedIncident.state === IncidentState.RESOLVED ||
      persistedIncident.state === IncidentState.REJECTED
    ) {
      throw new Error(
        `Aborted remediation PR creation: incident '${incidentId}' is in terminal state '${persistedIncident?.state ?? 'missing'}'`
      );
    }

    // Create Remediation PR while incident remains in REMEDIATING so TTPR includes PR latency
    const prTitleSummary = truncate(sanitizeWhitespace(synthesis.summary), 72, '');
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

    // Transition to AWAITING_PR only after createRemediationPr succeeds
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
