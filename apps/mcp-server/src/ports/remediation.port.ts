export interface RemediationPrRequest {
  incident_id: string;
  file_path: string;
  patched_content: string;
  blob_sha?: string;
  title: string;
  rca_markdown: string;
  reasoning_source: 'llm' | 'fallback';
}

export interface RemediationPrReceipt {
  branchName: string;
  branchUrl: string;
  pullRequestUrl: string;
  commitSha: string;
}

export interface RemediationPort {
  createPullRequest(req: RemediationPrRequest): Promise<RemediationPrReceipt>;
}
