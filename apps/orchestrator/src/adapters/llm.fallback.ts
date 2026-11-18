import fs from 'node:fs';
import { compact, isNonEmptyString } from '@zeromttr/utils';
import { OrchestratorDefault, ReasoningProvider } from '../domain/index.js';
import type { ReasoningPort, CollectedEvidence, RcaAndPatchSynthesis } from '../ports/index.js';

export interface FallbackReasoningOptions {
  patchTemplate?: string;
  patchFilePath?: string;
  defaultSummary?: string;
  defaultRootCause?: string;
  defaultExplanation?: string;
}

export class DeterministicFallbackReasoningAdapter implements ReasoningPort {
  public constructor(private readonly options: FallbackReasoningOptions = {}) {}

  private resolvePatchContent(evidence: CollectedEvidence, suspectFilePath: string): string {
    if (isNonEmptyString(this.options.patchTemplate)) {
      return this.options.patchTemplate;
    }

    const configuredFile = this.options.patchFilePath ?? process.env.FALLBACK_PATCH_FILE;
    if (isNonEmptyString(configuredFile) && fs.existsSync(configuredFile)) {
      const content = fs.readFileSync(configuredFile, 'utf-8');
      if (isNonEmptyString(content)) {
        return content;
      }
    }

    const commitSha = evidence.gitDiff?.suspectCommit || OrchestratorDefault.UNKNOWN;
    const diffExcerpt = isNonEmptyString(evidence.gitDiff?.patch)
      ? evidence.gitDiff.patch
      : 'No diff excerpt available.';

    return [
      `/* Deterministic fallback remediation summary for ${evidence.service} (${evidence.alertName}) */`,
      `/* Suspect file: ${suspectFilePath} | Suspect commit: ${commitSha} */`,
      `/* Deploy diff excerpt:\n${diffExcerpt}\n*/`
    ].join('\n');
  }

  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    const suspectFilePath = isNonEmptyString(evidence.gitDiff?.suspectFilePath)
      ? evidence.gitDiff.suspectFilePath
      : 'README.md';
    const commitSha = evidence.gitDiff?.suspectCommit || OrchestratorDefault.UNKNOWN;
    const baseRef = evidence.gitDiff?.baseRef || OrchestratorDefault.DEFAULT_BASE_REF;
    const headRef = evidence.gitDiff?.headRef || OrchestratorDefault.DEFAULT_HEAD_REF;

    const evidenceRefs = compact([
      evidence.traceAnalysis?.traceId,
      OrchestratorDefault.DEFAULT_METRIC,
      evidence.gitDiff?.suspectCommit
    ]).filter(isNonEmptyString);

    return {
      summary:
        this.options.defaultSummary ||
        `Service degradation detected on ${evidence.service} (${evidence.alertName}).`,
      rootCause:
        this.options.defaultRootCause ||
        `Deterministic fallback correlated telemetry degradation on '${evidence.service}' with deploy commit '${commitSha}' touching '${suspectFilePath}'.`,
      evidenceRefs,
      suspectFilePath,
      patchedContent: this.resolvePatchContent(evidence, suspectFilePath),
      explanation:
        this.options.defaultExplanation ||
        `Fallback synthesis generated without external LLM calls. Inspect diff ${baseRef}...${headRef} on '${suspectFilePath}' before merging.`,
      reasoningSource: ReasoningProvider.FALLBACK
    };
  }
}
