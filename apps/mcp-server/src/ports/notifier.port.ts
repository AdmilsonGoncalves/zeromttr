export interface PostMortemNotification {
  incident_id: string;
  recipient_email?: string;
  title: string;
  rca_summary: string;
  evidence_coverage: string;
  reasoning_source: 'llm' | 'fallback';
  blast_radius: string[];
  regression_commit: string;
  pull_request_url: string;
  approve_url: string;
  reject_url: string;
  leaked_patterns_detected?: number;
}

export interface NotificationReceipt {
  id: string;
  delivered: boolean;
}

export interface NotifierPort {
  sendPostMortem(req: PostMortemNotification): Promise<NotificationReceipt>;
}
