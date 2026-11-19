import fs from 'node:fs';
import { compact, isNonEmptyString, isObject, safeJsonParse } from '@zeromttr/utils';
import {
  buildUrl,
  isHttpSuccess,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '@zeromttr/utils/http';
import { OrchestratorDefault, ReasoningProvider } from '../domain/index.js';
import type { ReasoningPort, CollectedEvidence, RcaAndPatchSynthesis } from '../ports/index.js';

export interface FallbackReasoningOptions {
  patchTemplate?: string;
  patchFilePath?: string;
  githubApiBaseUrl?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubToken?: string;
  defaultSummary?: string;
  defaultRootCause?: string;
  defaultExplanation?: string;
}

export class DeterministicFallbackReasoningAdapter implements ReasoningPort {
  public constructor(private readonly options: FallbackReasoningOptions = {}) {}

  private resolveGithubOwnerRepo(): { owner: string; repo: string } | null {
    const explicitOwner = this.options.githubOwner ?? process.env.GITHUB_OWNER;
    const explicitRepo = this.options.githubRepo ?? process.env.GITHUB_REPO;
    if (isNonEmptyString(explicitOwner) && isNonEmptyString(explicitRepo)) {
      return { owner: explicitOwner, repo: explicitRepo };
    }

    const repoSpec = explicitRepo ?? process.env.TARGET_GITHUB_REPO ?? '';
    if (!isNonEmptyString(repoSpec)) {
      return null;
    }

    const normalized = repoSpec
      .trim()
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }

    return null;
  }

  private async fetchBaselineFromGithub(
    suspectFilePath: string,
    baseRef: string
  ): Promise<string | null> {
    const resolved = this.resolveGithubOwnerRepo();
    if (!resolved || !isNonEmptyString(baseRef)) {
      return null;
    }

    const apiBase = trimTrailingSlash(
      this.options.githubApiBaseUrl || process.env.GITHUB_API_BASE_URL || 'https://api.github.com'
    );
    const token = this.options.githubToken ?? process.env.GITHUB_TOKEN ?? '';
    const encodedPath = suspectFilePath.split('/').map(encodeURIComponent).join('/');
    const url = buildUrl(
      apiBase,
      `/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}/contents/${encodedPath}`,
      {
        ref: baseRef
      }
    );

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'zeromttr-orchestrator'
      };
      if (isNonEmptyString(token)) {
        headers.Authorization = `Bearer ${sanitizeHeaderValue(token)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5_000)
      });

      if (!isHttpSuccess(response.status) || !response.ok) {
        return null;
      }

      let body: unknown;
      if (typeof response.text === 'function') {
        const bodyText = await response.text();
        if (isNonEmptyString(bodyText)) {
          body = safeJsonParse<unknown>(bodyText);
        }
      }
      if (!body && typeof response.json === 'function') {
        body = await response.json();
      }
      if (!isObject(body) || !isNonEmptyString(body.content)) {
        return null;
      }

      const decoded =
        body.encoding === 'base64'
          ? Buffer.from(body.content.replace(/\s+/g, ''), 'base64').toString('utf-8')
          : body.content;

      return isNonEmptyString(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }

  private async resolvePatchContent(
    evidence: CollectedEvidence,
    suspectFilePath: string,
    baseRef: string
  ): Promise<string> {
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

    const githubBaseline = await this.fetchBaselineFromGithub(suspectFilePath, baseRef);
    if (isNonEmptyString(githubBaseline)) {
      return githubBaseline;
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
      patchedContent: await this.resolvePatchContent(evidence, suspectFilePath, baseRef),
      explanation:
        this.options.defaultExplanation ||
        `Fallback synthesis generated without external LLM calls. Inspect diff ${baseRef}...${headRef} on '${suspectFilePath}' before merging.`,
      reasoningSource: ReasoningProvider.FALLBACK
    };
  }
}
