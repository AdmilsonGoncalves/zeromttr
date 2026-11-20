import { z } from 'zod';
import type {
  RemediationPort,
  RemediationPrRequest,
  RemediationPrReceipt
} from '../ports/remediation.port.js';
import { isNonEmptyArray, isNonEmptyString, isSafeRelativePath } from '@zeromttr/utils';
import {
  HTTP_STATUS,
  buildUrl,
  isHttpSuccess,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '@zeromttr/utils/http';

const GithubRefSchema = z.object({
  object: z.object({ sha: z.string().optional() }).optional(),
  sha: z.string().optional()
});

const GithubFileShaSchema = z.object({
  sha: z.string().optional()
});

const GithubPutFileSchema = z.object({
  commit: z.object({ sha: z.string().optional() }).optional(),
  content: z.object({ sha: z.string().optional() }).optional()
});

const GithubPullSchema = z.object({
  html_url: z.string()
});

const GithubOpenPrListSchema = z.array(GithubPullSchema);

export interface GithubRemediationConfig {
  repo: string;
  baseBranch: string;
  githubToken?: string;
  apiBaseUrl?: string;
}

export class GithubRemediationHttpAdapter implements RemediationPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GithubRemediationConfig) {
    this.baseUrl = trimTrailingSlash(config.apiBaseUrl || 'https://api.github.com');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ZeroMTTR-MCP-Server'
    };
    if (isNonEmptyString(this.config.githubToken)) {
      headers.Authorization = `Bearer ${sanitizeHeaderValue(this.config.githubToken)}`;
    }
    return headers;
  }

  async createPullRequest(req: RemediationPrRequest): Promise<RemediationPrReceipt> {
    if (!/^[A-Za-z0-9._-]+$/.test(req.incident_id)) {
      throw new Error(
        `Invalid incident_id '${req.incident_id}'. Must match pattern /^[A-Za-z0-9._-]+$/`
      );
    }

    if (!isSafeRelativePath(req.file_path)) {
      throw new Error(
        `Invalid file_path '${req.file_path}'. Must be a safe repository-relative path without dot segments.`
      );
    }

    const repo = this.config.repo;
    const branchName = `hotfix/zeromttr-${req.incident_id}`;
    const encodedBranchPath = branchName.split('/').map(encodeURIComponent).join('/');
    const baseBranch = this.config.baseBranch || 'release/target-v2.14.8';
    const encodedBaseBranchPath = baseBranch.split('/').map(encodeURIComponent).join('/');

    // 1. Ensure branch exists idempotently
    const branchRefUrl = buildUrl(
      this.baseUrl,
      `/repos/${repo}/git/ref/heads/${encodedBranchPath}`
    );
    const branchRefRes = await fetch(branchRefUrl, { headers: this.getHeaders() });

    if (!isHttpSuccess(branchRefRes.status)) {
      if (branchRefRes.status !== HTTP_STATUS.NOT_FOUND) {
        throw new Error(
          `Failed to check branch '${branchName}': ${branchRefRes.status} ${branchRefRes.statusText}`
        );
      }

      // 404: Get base branch head SHA and create branch
      const baseRefUrl = buildUrl(
        this.baseUrl,
        `/repos/${repo}/git/ref/heads/${encodedBaseBranchPath}`
      );
      const baseRefRes = await fetch(baseRefUrl, { headers: this.getHeaders() });
      if (!isHttpSuccess(baseRefRes.status)) {
        throw new Error(
          `Failed to get base branch '${baseBranch}': ${baseRefRes.status} ${baseRefRes.statusText}`
        );
      }
      const baseRefParsed = GithubRefSchema.safeParse(await baseRefRes.json());
      const baseSha = baseRefParsed.success
        ? baseRefParsed.data.object?.sha || baseRefParsed.data.sha
        : undefined;

      // Create branch
      const createRefUrl = buildUrl(this.baseUrl, `/repos/${repo}/git/refs`);
      const createRefRes = await fetch(createRefUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha
        })
      });

      if (
        !isHttpSuccess(createRefRes.status) &&
        createRefRes.status !== HTTP_STATUS.UNPROCESSABLE_ENTITY
      ) {
        throw new Error(
          `Failed to create branch '${branchName}': ${createRefRes.status} ${createRefRes.statusText}`
        );
      }
    }

    // 2. Fetch current blob sha of target file on the hotfix branch
    let blobSha = req.blob_sha;
    const encodedFilePath = req.file_path.split('/').map(encodeURIComponent).join('/');
    const fileUrl = buildUrl(this.baseUrl, `/repos/${repo}/contents/${encodedFilePath}`);
    const getFileUrl = buildUrl(this.baseUrl, `/repos/${repo}/contents/${encodedFilePath}`, {
      ref: branchName
    });
    const fileRes = await fetch(getFileUrl, { headers: this.getHeaders() });
    if (isHttpSuccess(fileRes.status)) {
      const fileParsed = GithubFileShaSchema.safeParse(await fileRes.json());
      if (fileParsed.success) {
        blobSha = fileParsed.data.sha || blobSha;
      }
    }

    // 3. Commit surgical patch with dynamic commit message
    const commitMessage = `${req.title} [incident ${req.incident_id}]`;
    const putFileRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(req.patched_content).toString('base64'),
        sha: blobSha,
        branch: branchName
      })
    });

    if (!isHttpSuccess(putFileRes.status)) {
      const errText = await putFileRes.text();
      throw new Error(
        `Failed to commit patch to '${req.file_path}': ${putFileRes.status} ${errText}`
      );
    }

    const putFileParsed = GithubPutFileSchema.safeParse(await putFileRes.json());
    const commitSha = putFileParsed.success
      ? putFileParsed.data.commit?.sha || putFileParsed.data.content?.sha || ''
      : '';

    // 4. Idempotently create Pull Request
    let pullRequestUrl = '';
    const owner = repo.split('/')[0];
    const listPrUrl = buildUrl(this.baseUrl, `/repos/${repo}/pulls`, {
      head: `${owner}:${branchName}`,
      base: baseBranch,
      state: 'open'
    });
    const listPrRes = await fetch(listPrUrl, { headers: this.getHeaders() });

    if (isHttpSuccess(listPrRes.status)) {
      const openPrsParsed = GithubOpenPrListSchema.safeParse(await listPrRes.json());
      if (openPrsParsed.success && isNonEmptyArray<{ html_url: string }>(openPrsParsed.data)) {
        pullRequestUrl = openPrsParsed.data[0].html_url;
      }
    }

    if (!pullRequestUrl) {
      const prBody = `${req.rca_markdown}\n\n---\n**Reasoning Source:** \`${req.reasoning_source}\`\n**ZeroMTTR Autonomous Remediation** (No auto-merge enabled)`;
      const createPrUrl = buildUrl(this.baseUrl, `/repos/${repo}/pulls`);
      const createPrRes = await fetch(createPrUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          title: req.title,
          head: branchName,
          base: baseBranch,
          body: prBody
        })
      });

      if (!isHttpSuccess(createPrRes.status)) {
        const errText = await createPrRes.text();
        throw new Error(`Failed to create Pull Request: ${createPrRes.status} ${errText}`);
      }

      const createPrData = GithubPullSchema.parse(await createPrRes.json());
      pullRequestUrl = createPrData.html_url;
    }

    const branchUrl = `https://github.com/${repo}/tree/${branchName}`;

    return {
      branchName,
      branchUrl,
      pullRequestUrl,
      commitSha
    };
  }
}
