import type {
  RemediationPort,
  RemediationPrRequest,
  RemediationPrReceipt
} from '../ports/index.js';
import { isSafeRelativePath } from '@zeromttr/utils';

export interface GithubRemediationConfig {
  repo: string;
  baseBranch: string;
  githubToken?: string;
  apiBaseUrl?: string;
}

export class GithubRemediationHttpAdapter implements RemediationPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GithubRemediationConfig) {
    this.baseUrl = (config.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ZeroMTTR-MCP-Server'
    };
    if (this.config.githubToken) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
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
    const encodedBranchName = encodeURIComponent(branchName);
    const encodedBranchPath = branchName.split('/').map(encodeURIComponent).join('/');
    const baseBranch = this.config.baseBranch || 'release/target-v2.14.8';
    const encodedBaseBranchPath = baseBranch.split('/').map(encodeURIComponent).join('/');

    // 1. Ensure branch exists idempotently
    const branchRefUrl = `${this.baseUrl}/repos/${repo}/git/ref/heads/${encodedBranchPath}`;
    const branchRefRes = await fetch(branchRefUrl, { headers: this.getHeaders() });

    if (!branchRefRes.ok) {
      if (branchRefRes.status !== 404) {
        throw new Error(
          `Failed to check branch '${branchName}': ${branchRefRes.status} ${branchRefRes.statusText}`
        );
      }

      // 404: Get base branch head SHA and create branch
      const baseRefUrl = `${this.baseUrl}/repos/${repo}/git/ref/heads/${encodedBaseBranchPath}`;
      const baseRefRes = await fetch(baseRefUrl, { headers: this.getHeaders() });
      if (!baseRefRes.ok) {
        throw new Error(
          `Failed to get base branch '${baseBranch}': ${baseRefRes.status} ${baseRefRes.statusText}`
        );
      }
      const baseRefData = (await baseRefRes.json()) as {
        object?: { sha?: string };
        sha?: string;
      };
      const baseSha = baseRefData.object?.sha || baseRefData.sha;

      // Create branch
      const createRefUrl = `${this.baseUrl}/repos/${repo}/git/refs`;
      const createRefRes = await fetch(createRefUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha
        })
      });

      if (!createRefRes.ok && createRefRes.status !== 422) {
        throw new Error(
          `Failed to create branch '${branchName}': ${createRefRes.status} ${createRefRes.statusText}`
        );
      }
    }

    // 2. Fetch current blob sha of target file on the hotfix branch
    let blobSha = req.blob_sha;
    const encodedFilePath = req.file_path.split('/').map(encodeURIComponent).join('/');
    const fileUrl = `${this.baseUrl}/repos/${repo}/contents/${encodedFilePath}`;
    const getFileUrl = `${fileUrl}?ref=${encodedBranchName}`;
    const fileRes = await fetch(getFileUrl, { headers: this.getHeaders() });
    if (fileRes.ok) {
      const fileData = (await fileRes.json()) as { sha?: string };
      blobSha = fileData.sha || blobSha;
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

    if (!putFileRes.ok) {
      const errText = await putFileRes.text();
      throw new Error(
        `Failed to commit patch to '${req.file_path}': ${putFileRes.status} ${errText}`
      );
    }

    const putFileData = (await putFileRes.json()) as {
      commit?: { sha?: string };
      content?: { sha?: string };
    };
    const commitSha = putFileData.commit?.sha || putFileData.content?.sha || '';

    // 4. Idempotently create Pull Request
    let pullRequestUrl = '';
    const owner = repo.split('/')[0];
    const headParam = encodeURIComponent(`${owner}:${branchName}`);
    const baseParam = encodeURIComponent(baseBranch);
    const listPrUrl = `${this.baseUrl}/repos/${repo}/pulls?head=${headParam}&base=${baseParam}&state=open`;
    const listPrRes = await fetch(listPrUrl, { headers: this.getHeaders() });

    if (listPrRes.ok) {
      const openPrs = (await listPrRes.json()) as Array<{ html_url: string }>;
      if (Array.isArray(openPrs) && openPrs.length > 0) {
        pullRequestUrl = openPrs[0].html_url;
      }
    }

    if (!pullRequestUrl) {
      const prBody = `${req.rca_markdown}\n\n---\n**Reasoning Source:** \`${req.reasoning_source}\`\n**ZeroMTTR Autonomous Remediation** (No auto-merge enabled)`;
      const createPrUrl = `${this.baseUrl}/repos/${repo}/pulls`;
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

      if (!createPrRes.ok) {
        const errText = await createPrRes.text();
        throw new Error(`Failed to create Pull Request: ${createPrRes.status} ${errText}`);
      }

      const createPrData = (await createPrRes.json()) as { html_url: string };
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
