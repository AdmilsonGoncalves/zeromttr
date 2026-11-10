import type {
  NotifierPort,
  PostMortemNotification,
  NotificationReceipt
} from '../ports/notifier.port.js';

export interface ResendAdapterConfig {
  apiKey: string;
  from: string;
  apiBaseUrl?: string;
}

export function escapeHtml(unsafe: string): string {
  if (!unsafe) {
    return '';
  }
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function safeHttpUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '#';
  } catch {
    return '#';
  }
}

export function renderPostMortemHtml(req: PostMortemNotification): string {
  const safeTitle = escapeHtml(req.title);
  const safeRca = escapeHtml(req.rca_summary);
  const safeCoverage = escapeHtml(req.evidence_coverage);
  const safeSource = escapeHtml(req.reasoning_source);
  const safeCommit = escapeHtml(req.regression_commit);
  const safeServices = req.blast_radius.map(escapeHtml).join(', ');
  const safeApproveUrl = escapeHtml(safeHttpUrl(req.approve_url));
  const safeRejectUrl = escapeHtml(safeHttpUrl(req.reject_url));
  const safePrUrl = escapeHtml(safeHttpUrl(req.pull_request_url));
  const leakedCount = req.leaked_patterns_detected ?? 0;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; }
    .container { max-width: 640px; margin: 0 auto; background: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 32px; }
    h1 { font-size: 20px; color: #38bdf8; margin-top: 0; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #0369a1; color: #e0f2fe; margin-right: 6px; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .meta-table td { padding: 8px 12px; border-bottom: 1px solid #334155; }
    .meta-table td:first-child { color: #94a3b8; font-weight: 600; width: 35%; }
    .rca-box { background: #0f172a; border-left: 4px solid #38bdf8; padding: 12px 16px; border-radius: 4px; margin: 16px 0; font-size: 14px; }
    .actions { margin-top: 28px; display: flex; gap: 12px; }
    .btn { display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; text-align: center; }
    .btn-approve { background: #10b981; color: #ffffff; }
    .btn-reject { background: #ef4444; color: #ffffff; }
    .btn-pr { background: #3b82f6; color: #ffffff; margin-top: 12px; }
    .footer { margin-top: 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚨 ZeroMTTR Incident Post-Mortem & Remediation</h1>
    <div>
      <span class="badge">Coverage: ${safeCoverage}</span>
      <span class="badge">Reasoning: ${safeSource}</span>
      <span class="badge">PII Leaks: ${leakedCount}</span>
    </div>

    <table class="meta-table">
      <tr><td>Incident ID</td><td><code>${escapeHtml(req.incident_id)}</code></td></tr>
      <tr><td>Blast Radius</td><td>${safeServices || 'None'}</td></tr>
      <tr><td>Regression Commit</td><td><code>${safeCommit}</code></td></tr>
    </table>

    <div class="rca-box">
      <strong>Root Cause Analysis:</strong>
      <p>${safeRca}</p>
    </div>

    <div>
      <a href="${safePrUrl}" class="btn btn-pr" target="_blank" rel="noopener noreferrer">Review Pull Request on GitHub</a>
    </div>

    <div class="actions" style="margin-top: 24px;">
      <a href="${safeApproveUrl}" class="btn btn-approve" target="_blank" rel="noopener noreferrer">Aprovar Hotfix</a>
      &nbsp;
      <a href="${safeRejectUrl}" class="btn btn-reject" target="_blank" rel="noopener noreferrer">Rejeitar Hotfix</a>
    </div>

    <div class="footer">
      <p>Decisão segura assinada via HMAC no fragmento URI (#). Zero credenciais expostas em logs.</p>
      <p>ZeroMTTR Autonomous SRE Platform — Logística & Automação</p>
    </div>
  </div>
</body>
</html>`;
}

export class ResendHttpAdapter implements NotifierPort {
  private readonly baseUrl: string;

  constructor(private readonly config: ResendAdapterConfig) {
    this.baseUrl = (config.apiBaseUrl || 'https://api.resend.com').replace(/\/$/, '');
  }

  async sendPostMortem(req: PostMortemNotification): Promise<NotificationReceipt> {
    if (!this.config.apiKey) {
      throw new Error('Resend API key is missing or empty');
    }

    const html = renderPostMortemHtml(req);
    const recipient = req.recipient_email || 'oncall-sre@example.com';

    const url = `${this.baseUrl}/emails`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `post-mortem-${req.incident_id}`
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [recipient],
        subject: req.title,
        html
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Resend send email failed: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as { id?: string };
    return {
      id: data.id || `resend-${Date.now()}`,
      delivered: true
    };
  }
}
