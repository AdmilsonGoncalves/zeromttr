import type {
  RepoInspectorPort,
  DeployDiffRequest,
  DeployDiffBundle
} from '../ports/repo-inspector.port.js';

export class InspectGitDeployDiff {
  constructor(private readonly repoInspectorPort: RepoInspectorPort) {}

  async execute(input: DeployDiffRequest): Promise<DeployDiffBundle> {
    if (!input.base_ref || !input.head_ref) {
      throw new Error('Both base_ref and head_ref are required to inspect deploy diff.');
    }
    return this.repoInspectorPort.inspectDeployDiff(input);
  }
}
