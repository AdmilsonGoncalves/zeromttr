import type {
  RepoInspectorPort,
  DeployDiffRequest,
  DeployDiffBundle,
  DeployDiffFile
} from '../ports/repo-inspector.port.js';
import { truncateDiff, sanitizeAuthorLogin, sanitizeCommitMessage } from '../domain/truncate.js';
import { calculateFinOps } from '../domain/finops.js';

export interface GithubInspectorConfig {
  repo: string;
  githubToken?: string;
  apiBaseUrl?: string;
}

export class GithubInspectorHttpAdapter implements RepoInspectorPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GithubInspectorConfig) {
    this.baseUrl = (config.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ZeroMTTR-MCP-Server'
    };
    if (this.config.githubToken) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
    }
    return headers;
  }

  async inspectDeployDiff(req: DeployDiffRequest): Promise<DeployDiffBundle> {
    const compareUrl = `${this.baseUrl}/repos/${this.config.repo}/compare/${encodeURIComponent(req.base_ref)}...${encodeURIComponent(req.head_ref)}`;
    const compareRes = await fetch(compareUrl, { headers: this.getHeaders() });

    if (!compareRes.ok) {
      throw new Error(`GitHub compare failed: ${compareRes.status} ${compareRes.statusText}`);
    }

    const compareText = await compareRes.text();
    let rawBytesFetched = Buffer.byteLength(compareText, 'utf-8');

    let compareData: {
      commits?: Array<{
        author?: { login?: string; name?: string; email?: string };
        commit?: {
          author?: { login?: string; name?: string; email?: string };
          message?: string;
        };
      }>;
      files?: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>;
    };
    try {
      compareData = JSON.parse(compareText);
    } catch (err) {
      throw new Error(`Failed to parse GitHub compare JSON: ${(err as Error).message}`);
    }

    // Extract author and commit message with strict PII sanitization
    let authorLogin = 'unknown';
    let rawCommitMessage = '';
    const commits = compareData.commits || [];
    if (commits.length > 0) {
      const targetCommit = commits[commits.length - 1];
      authorLogin = sanitizeAuthorLogin(targetCommit.author || targetCommit.commit?.author);
      rawCommitMessage = targetCommit.commit?.message || '';
    }
    const sanitizedCommitMessage = sanitizeCommitMessage(rawCommitMessage);

    // Filter files
    const allFiles = compareData.files || [];
    const servicePath = req.service_path || '';
    let filteredFiles = allFiles;
    if (servicePath) {
      filteredFiles = allFiles.filter((f) => f.filename?.startsWith(servicePath));
      if (filteredFiles.length === 0) {
        filteredFiles = allFiles;
      }
    }

    // Max 3 relevant files
    const topFiles = filteredFiles.slice(0, 3);
    const filesChanged: DeployDiffFile[] = topFiles.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? truncateDiff(f.patch, 1500) : undefined
    }));

    // Find suspect file
    let suspectFileItem = filesChanged.find(
      (f) =>
        req.suspect_keyword && f.filename.toLowerCase().includes(req.suspect_keyword.toLowerCase())
    );
    if (!suspectFileItem && filesChanged.length > 0) {
      suspectFileItem = filesChanged[0];
    }

    let suspectFileResult: { path: string; blob_sha: string; content: string } | undefined;

    if (suspectFileItem) {
      const encodedPath = suspectFileItem.filename.split('/').map(encodeURIComponent).join('/');
      const contentsUrl = `${this.baseUrl}/repos/${this.config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(req.head_ref)}`;
      const contentsRes = await fetch(contentsUrl, { headers: this.getHeaders() });
      if (contentsRes.ok) {
        const contentsText = await contentsRes.text();
        rawBytesFetched += Buffer.byteLength(contentsText, 'utf-8');
        try {
          const contentsData = JSON.parse(contentsText);
          const decoded = contentsData.content
            ? Buffer.from(contentsData.content, 'base64').toString('utf-8')
            : '';
          const cappedContent = truncateDiff(decoded, 8000);
          suspectFileResult = {
            path: suspectFileItem.filename,
            blob_sha: contentsData.sha || '',
            content: cappedContent
          };
        } catch {
          // ignore parsing error for contents fallback
        }
      }
    }

    const bundleWithoutFinops = {
      base_ref: req.base_ref,
      head_ref: req.head_ref,
      author_login: authorLogin,
      commit_message: sanitizedCommitMessage,
      files_changed: filesChanged,
      suspect_file: suspectFileResult
    };

    const compactedBytes = Buffer.byteLength(JSON.stringify(bundleWithoutFinops), 'utf-8');
    const finops = calculateFinOps(rawBytesFetched, compactedBytes);

    return {
      ...bundleWithoutFinops,
      raw_bytes_fetched: finops.raw_bytes_fetched,
      compacted_bytes_sent_to_llm: finops.compacted_bytes_sent_to_llm,
      payload_reduction_percent: finops.payload_reduction_percent,
      estimated_tokens_saved: finops.estimated_tokens_saved
    };
  }
}
