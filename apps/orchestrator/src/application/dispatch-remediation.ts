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
import type { Incident } from '../domain/incident.js';
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

function isTruncatedSuspectFile(suspectFileContent?: string): boolean {
  return isNonEmptyString(suspectFileContent) && suspectFileContent.includes('[TRUNCATED_DIFF]');
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

function hasValidPatchTargetAndSyntax(
  synthesis: RcaAndPatchSynthesis,
  expectedSuspectPath?: string,
  syntaxValidator?: PatchSyntaxValidatorPort
): synthesis is RcaAndPatchSynthesis & { suspectFilePath: string; patchedContent: string } {
  const isPathValid =
    isNonEmptyString(expectedSuspectPath) &&
    isNonEmptyString(synthesis.suspectFilePath) &&
    synthesis.suspectFilePath === expectedSuspectPath;

  const isContentValid =
    isNonEmptyString(synthesis.patchedContent) &&
    (!syntaxValidator ||
      syntaxValidator.isValidSyntax(synthesis.suspectFilePath, synthesis.patchedContent));

  return isPathValid && isContentValid;
}

function validatePatchDefensively(
  synthesis: RcaAndPatchSynthesis,
  expectedSuspectPath?: string,
  options: DispatchRemediationOptions = {},
  suspectFileContent?: string
): boolean {
  if (!hasValidPatchTargetAndSyntax(synthesis, expectedSuspectPath, options.syntaxValidator)) {
    return false;
  }

  const content = synthesis.patchedContent;
  const originalExports =
    options.syntaxValidator?.getExportedSymbols && isNonEmptyString(suspectFileContent)
      ? options.syntaxValidator.getExportedSymbols(synthesis.suspectFilePath, suspectFileContent)
      : null;
  const patchedExports = originalExports
    ? (options.syntaxValidator?.getExportedSymbols?.(synthesis.suspectFilePath, content) ?? null)
    : null;

  if (originalExports && patchedExports) {
    const patchedSet = new Set(patchedExports);
    if (originalExports.some((symbol) => !patchedSet.has(symbol))) {
      return false;
    }
  }

  const requiredPatterns = [
    ...(options.requiredContentPatterns ?? []),
    ...(originalExports && patchedExports ? [] : extractRequiredExportPatterns(suspectFileContent))
  ];
  return requiredPatterns.every((pattern) => {
    if (pattern.global || pattern.sticky) {
      pattern.lastIndex = 0;
    }
    return pattern.test(content);
  });
}

type PiiAuditSummary = ReturnType<typeof PiiPromptGuard.inspectAndEnforceFailClosed>;

function buildRcaReport(
  incident: Incident,
  evidence: CollectedEvidence,
  synthesis: RcaAndPatchSynthesis,
  reasoningSource: ReasoningSource,
  piiAudit: PiiAuditSummary,
  annotationId: number | undefined
): RcaReport {
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

  return {
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

    let transitionedBeforeSynthesis = false;

    // Ensure valid lifecycle transitions to REMEDIATING before synthesis so UI and TTD reflect start of remediation
    if (incident.state === IncidentState.INVESTIGATING) {
      this.transitionAndBroadcast(
        incident,
        IncidentState.ENRICHING,
        TransitionReason.ENRICHING_BEFORE_REMEDIATION
      );
      transitionedBeforeSynthesis = true;
    }
    if (incident.state === IncidentState.ENRICHING) {
      this.transitionAndBroadcast(
        incident,
        IncidentState.REMEDIATING,
        TransitionReason.REMEDIATING_SYNTHESIS
      );
      transitionedBeforeSynthesis = true;
    }

    if (transitionedBeforeSynthesis) {
      await this.repository.save(incident);
    }

    const { synthesis, reasoningSource, piiAudit } = await this.synthesizeWithGuardrails(
      incident,
      evidence,
      authoritativeSuspectPath
    );

    const annotationId = await this.annotateRemediationStart(incident.id, synthesis.summary);

    const rcaReport = buildRcaReport(
      incident,
      evidence,
      synthesis,
      reasoningSource,
      piiAudit,
      annotationId
    );
    incident.rca = rcaReport;
    this.broadcaster.broadcast(IncidentEventType.RCA, {
      incidentId: incident.id,
      ...rcaReport
    });

    const prResult = await this.openRemediationPr(
      incident,
      evidence,
      synthesis,
      reasoningSource,
      blobSha
    );

    // Transition to AWAITING_PR only after createRemediationPr succeeds
    if (incident.state === IncidentState.REMEDIATING) {
      this.transitionAndBroadcast(
        incident,
        IncidentState.AWAITING_PR,
        TransitionReason.AWAITING_PR
      );
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

  private transitionAndBroadcast(
    incident: Incident,
    targetState: IncidentState,
    reason: TransitionReason
  ): void {
    const transition = incident.transition(targetState, reason);
    this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
      incidentId: incident.id,
      from: transition.from,
      to: transition.to,
      at: transition.at,
      reason: transition.reason
    });
  }

  private redactCredentials(rawMessage: string): string {
    return rawMessage
      .replace(/\s+/g, ' ')
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(
        /(\b(?:access_token|refresh_token|id_token|api_key|apikey|key|token|secret|password|client_secret)["']?\s*[=:]\s*["']?)[^&\s,;"'}]+/gi,
        '$1[REDACTED]'
      )
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_KEY]')
      .trim();
  }

  private isAcceptableLlmPatch(
    rawSynthesis: RcaAndPatchSynthesis,
    authoritativeSuspectPath: string,
    suspectFileContent: string | undefined
  ): boolean {
    try {
      return (
        isNonEmptyString(rawSynthesis.patchedContent) &&
        !isTruncatedLlmSnippet(rawSynthesis.patchedContent) &&
        validatePatchDefensively(
          rawSynthesis,
          authoritativeSuspectPath,
          this.options,
          suspectFileContent
        )
      );
    } catch {
      return false;
    }
  }

  private sanitizeLlmFailureReason(rawMessage: string): string {
    const cleaned = this.redactCredentials(rawMessage);

    if (!isNonEmptyString(cleaned)) {
      return 'LLM provider request failed';
    }

    const piiCheck = PiiPromptGuard.inspectAndEnforceFailClosed(cleaned);
    if (!piiCheck.passed) {
      return 'LLM provider request failed';
    }

    return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
  }

  private async synthesizeWithGuardrails(
    incident: Incident,
    evidence: CollectedEvidence,
    authoritativeSuspectPath: string
  ): Promise<{
    synthesis: RcaAndPatchSynthesis;
    reasoningSource: ReasoningSource;
    piiAudit: PiiAuditSummary;
  }> {
    const incidentId = incident.id;
    const promptToAudit = JSON.stringify(evidence);
    const piiAudit = PiiPromptGuard.inspectAndEnforceFailClosed(promptToAudit);
    const suspectFileContent = evidence.gitDiff?.suspectFileContent;

    let synthesis: RcaAndPatchSynthesis;
    let reasoningSource: ReasoningSource;
    let llmFailureReason: string | null = null;

    if (!piiAudit.passed) {
      // Fail-closed! Route directly to fallback
      this.logger?.warn({
        event: OrchestratorLogEvent.PII_PROMPT_GUARD_BLOCKED,
        incidentId,
        message: `Fail-closed PII guard blocked LLM dispatch (${piiAudit.detectedTypes.join(', ')})`
      });
      synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
      reasoningSource = ReasoningProvider.FALLBACK;
    } else if (isTruncatedSuspectFile(suspectFileContent)) {
      this.logger?.warn({
        event: OrchestratorLogEvent.LLM_PATCH_REJECTED,
        incidentId,
        message:
          'Suspect file content was truncated at policy cap; routing to deterministic fallback'
      });
      synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
      reasoningSource = ReasoningProvider.FALLBACK;
    } else {
      let rawSynthesis: RcaAndPatchSynthesis | null = null;
      try {
        rawSynthesis = await this.llmAdapter.synthesizeRcaAndPatch(evidence);
      } catch (err) {
        const rawError = toErrorMessage(err);
        llmFailureReason = this.sanitizeLlmFailureReason(rawError);
        this.logger?.warn({
          event: OrchestratorLogEvent.LLM_SYNTHESIS_FAILED,
          incidentId,
          message: this.redactCredentials(rawError)
        });
      }

      if (rawSynthesis === null) {
        try {
          synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
          reasoningSource = ReasoningProvider.FALLBACK;
        } catch (fallbackErr) {
          this.broadcaster.broadcast(IncidentEventType.LLM_FAILED, {
            incidentId,
            service: incident.service,
            error: llmFailureReason ?? 'LLM provider request failed',
            fallbackUsed: false,
            at: nowIso()
          });
          throw fallbackErr;
        }
      } else if (
        this.isAcceptableLlmPatch(rawSynthesis, authoritativeSuspectPath, suspectFileContent)
      ) {
        synthesis = rawSynthesis;
        reasoningSource = ReasoningProvider.LLM;
      } else {
        this.logger?.warn({
          event: OrchestratorLogEvent.LLM_PATCH_REJECTED,
          incidentId,
          message:
            'LLM synthesis patch rejected by defensive validation; routing to deterministic fallback'
        });
        synthesis = await this.fallbackAdapter.synthesizeRcaAndPatch(evidence);
        reasoningSource = ReasoningProvider.FALLBACK;
      }
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
      if (llmFailureReason) {
        this.broadcaster.broadcast(IncidentEventType.LLM_FAILED, {
          incidentId,
          service: incident.service,
          error: llmFailureReason,
          fallbackUsed: false,
          at: nowIso()
        });
      }
      throw new Error('Fallback remediation patch failed defensive validation');
    }

    if (llmFailureReason) {
      this.broadcaster.broadcast(IncidentEventType.LLM_FAILED, {
        incidentId,
        service: incident.service,
        error: llmFailureReason,
        fallbackUsed: true,
        at: nowIso()
      });
    }

    return { synthesis, reasoningSource, piiAudit };
  }

  private async annotateRemediationStart(
    incidentId: string,
    summary: string
  ): Promise<number | undefined> {
    try {
      const annRes = await this.tools.annotateGrafanaIncident({
        time: Date.now(),
        text: `[REMEDIATING] Incident ${incidentId}: ${summary}`,
        tags: [GrafanaAnnotationTag.REMEDIATION]
      });
      return annRes.annotationId;
    } catch (err) {
      // Ignore non-fatal annotation failure
      this.logger?.warn({
        event: OrchestratorLogEvent.GRAFANA_ANNOTATION_FAILED,
        incidentId,
        message: toErrorMessage(err)
      });
      return undefined;
    }
  }

  private async openRemediationPr(
    incident: Incident,
    evidence: CollectedEvidence,
    synthesis: RcaAndPatchSynthesis,
    reasoningSource: ReasoningSource,
    blobSha?: string
  ): Promise<CreateRemediationPrOutput> {
    // Re-check persisted state right before opening an external PR (e.g. if operator reset raced)
    const persistedIncident = await this.repository.findById(incident.id);
    if (
      !persistedIncident ||
      persistedIncident.state === IncidentState.FAILED ||
      persistedIncident.state === IncidentState.RESOLVED ||
      persistedIncident.state === IncidentState.REJECTED
    ) {
      throw new Error(
        `Aborted remediation PR creation: incident '${incident.id}' is in terminal state '${persistedIncident?.state ?? 'missing'}'`
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

    if (!isNonEmptyString(prResult.pullRequestUrl)) {
      throw new Error(
        `Remediation PR creation for incident '${incident.id}' returned an empty pullRequestUrl`
      );
    }

    incident.remediation = {
      ...prResult,
      suspectCommitSha: evidence.gitDiff?.suspectCommit
    };

    return prResult;
  }
}
