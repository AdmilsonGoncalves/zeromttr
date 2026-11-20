import { isNonEmptyString } from '@zeromttr/utils';
import type {
  RemediationPort,
  RemediationPrRequest,
  RemediationPrReceipt
} from '../ports/remediation.port.js';

/**
 * MCP use case validating remediation inputs and delegating hotfix Pull Request creation.
 */
export class CreateRemediationPr {
  constructor(private readonly remediationPort: RemediationPort) {}

  /**
   * Validates remediation PR inputs and delegates branch/PR creation to the remediation port.
   */
  async execute(input: RemediationPrRequest): Promise<RemediationPrReceipt> {
    if (
      !isNonEmptyString(input.incident_id) ||
      !isNonEmptyString(input.file_path) ||
      !isNonEmptyString(input.patched_content)
    ) {
      throw new Error('incident_id, file_path, and patched_content are required.');
    }
    if (input.reasoning_source !== 'llm' && input.reasoning_source !== 'fallback') {
      throw new Error("reasoning_source must be either 'llm' or 'fallback'.");
    }

    return this.remediationPort.createPullRequest(input);
  }
}
