import { isNonEmptyString } from '@zeromttr/utils';
import type {
  NotifierPort,
  PostMortemNotification,
  NotificationReceipt
} from '../ports/notifier.port.js';

/**
 * MCP use case validating decision URLs and dispatching post-mortem notifications via Resend.
 */
export class SendPostMortemResend {
  constructor(private readonly notifierPort: NotifierPort) {}

  /**
   * Validates required notification URLs and dispatches the post-mortem email via the notifier port.
   */
  async execute(input: PostMortemNotification): Promise<NotificationReceipt> {
    if (
      !isNonEmptyString(input.incident_id) ||
      !isNonEmptyString(input.approve_url) ||
      !isNonEmptyString(input.reject_url)
    ) {
      throw new Error('incident_id, approve_url, and reject_url are required.');
    }
    return this.notifierPort.sendPostMortem(input);
  }
}
