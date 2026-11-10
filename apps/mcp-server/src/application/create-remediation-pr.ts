import type {
  RemediationPort,
  RemediationPrRequest,
  RemediationPrReceipt
} from '../ports/index.js';

export class CreateRemediationPr {
  constructor(private readonly remediationPort: RemediationPort) {}

  async execute(input: RemediationPrRequest): Promise<RemediationPrReceipt> {
    if (!input.incident_id || !input.file_path || !input.patched_content) {
      throw new Error('incident_id, file_path, and patched_content are required.');
    }
    if (input.reasoning_source !== 'llm' && input.reasoning_source !== 'fallback') {
      throw new Error("reasoning_source must be either 'llm' or 'fallback'.");
    }

    return this.remediationPort.createPullRequest(input);
  }
}
