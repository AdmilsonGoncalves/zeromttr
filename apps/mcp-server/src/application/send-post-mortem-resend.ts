import type { NotifierPort, PostMortemNotification, NotificationReceipt } from '../ports/index.js';

export class SendPostMortemResend {
  constructor(private readonly notifierPort: NotifierPort) {}

  async execute(input: PostMortemNotification): Promise<NotificationReceipt> {
    if (!input.incident_id || !input.approve_url || !input.reject_url) {
      throw new Error('incident_id, approve_url, and reject_url are required.');
    }
    return this.notifierPort.sendPostMortem(input);
  }
}
