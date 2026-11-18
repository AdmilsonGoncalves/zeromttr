import { isNonEmptyString } from '@zeromttr/utils';
import type { NotifierPort, PostMortemNotification, NotificationReceipt } from '../ports/index.js';

export class SendPostMortemResend {
  constructor(private readonly notifierPort: NotifierPort) {}

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
