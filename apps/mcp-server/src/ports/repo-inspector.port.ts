export interface DeployDiffRequest {
  base_ref: string;
  head_ref: string;
  service_path?: string;
  suspect_keyword?: string;
}

export interface DeployDiffFile {
  filename: string;
  status: string;
  patch?: string;
  additions?: number;
  deletions?: number;
}

export interface DeployDiffBundle {
  base_ref: string;
  head_ref: string;
  author_login: string;
  commit_message: string;
  files_changed: DeployDiffFile[];
  suspect_file?: {
    path: string;
    blob_sha: string;
    content: string;
  };
  raw_bytes_fetched: number;
  compacted_bytes_sent_to_llm: number;
  payload_reduction_percent: number;
  estimated_tokens_saved: number;
}

export interface RepoInspectorPort {
  inspectDeployDiff(req: DeployDiffRequest): Promise<DeployDiffBundle>;
}
