import type {
  NotifierPort,
  PostMortemNotification,
  NotificationReceipt
} from '../ports/notifier.port.js';
import { escapeHtml, isEmpty } from '@zeromttr/utils';
import {
  CONTENT_TYPE,
  HTTP_HEADERS,
  buildUrl,
  isHttpSuccess,
  safeHttpUrl,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '@zeromttr/utils/http';

export { escapeHtml, safeHttpUrl };

export interface ResendAdapterConfig {
  apiKey: string;
  from: string;
  apiBaseUrl?: string;
  defaultRecipient?: string;
}

/**
 * Renders an HTML post-mortem email body with escaped fields and signed decision links.
 */
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; margin: 0;">
  <div style="max-width: 640px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; border: 1px solid #334155; padding: 32px; color: #f8fafc;">
    <h1 style="font-size: 20px; color: #38bdf8; margin-top: 0; font-weight: bold;">🚨 ZeroMTTR Incident Post-Mortem & Remediation</h1>
    <div style="margin-bottom: 20px;">
      <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background-color: #0284c7; color: #ffffff; margin-right: 6px;">Coverage: ${safeCoverage}</span>
      <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background-color: #0284c7; color: #ffffff; margin-right: 6px;">Reasoning: ${safeSource}</span>
      <span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background-color: #0284c7; color: #ffffff;">PII Leaks: ${leakedCount}</span>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; color: #f8fafc;">
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 600; width: 35%;">Incident ID</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #f8fafc;"><code style="font-family: monospace; background-color: #0f172a; color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 13px;">${escapeHtml(req.incident_id)}</code></td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 600; width: 35%;">Blast Radius</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #f8fafc;">${safeServices || 'None'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 600; width: 35%;">Regression Commit</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #334155; color: #f8fafc;"><code style="font-family: monospace; background-color: #0f172a; color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 13px;">${safeCommit}</code></td>
      </tr>
    </table>

    <div style="background-color: #0f172a; border-left: 4px solid #38bdf8; padding: 14px 18px; border-radius: 4px; margin: 20px 0;">
      <strong style="color: #38bdf8; display: block; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Root Cause Analysis:</strong>
      <p style="color: #f1f5f9; margin: 0; line-height: 1.6; font-size: 14px;">${safeRca}</p>
    </div>

    <div style="margin-top: 20px;">
      <a href="${safePrUrl}" style="display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; text-align: center; background-color: #0284c7; color: #ffffff;" target="_blank" rel="noopener noreferrer">Review Pull Request on GitHub</a>
    </div>

    <div style="margin-top: 24px;">
      <a href="${safeApproveUrl}" style="display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; text-align: center; background-color: #10b981; color: #ffffff; margin-right: 8px;" target="_blank" rel="noopener noreferrer">Aprovar Hotfix</a>
      <a href="${safeRejectUrl}" style="display: inline-block; padding: 10px 20px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; text-align: center; background-color: #ef4444; color: #ffffff;" target="_blank" rel="noopener noreferrer">Rejeitar Hotfix</a>
    </div>

    <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #334155; text-align: center;">
      <p style="margin: 4px 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">Decisão segura assinada via HMAC no fragmento URI (#). Zero credenciais expostas em logs.</p>
      <p style="margin: 4px 0; font-size: 12px; color: #64748b; line-height: 1.5;">ZeroMTTR Autonomous SRE Platform — Logística & Automação</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Resend API adapter delivering idempotent HTML post-mortem notifications with signed decision links.
 */
export class ResendHttpAdapter implements NotifierPort {
  private readonly baseUrl: string;

  constructor(private readonly config: ResendAdapterConfig) {
    this.baseUrl = trimTrailingSlash(config.apiBaseUrl || 'https://api.resend.com');
  }

  /**
   * Sends an idempotent post-mortem notification email with HMAC decision buttons via Resend.
   */
  async sendPostMortem(req: PostMortemNotification): Promise<NotificationReceipt> {
    if (isEmpty(this.config.apiKey)) {
      throw new Error('Resend API key is missing or empty');
    }

    const html = renderPostMortemHtml(req);
    const recipient =
      req.recipient_email || this.config.defaultRecipient || 'oncall-sre@example.com';

    const url = buildUrl(this.baseUrl, '/emails');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        [HTTP_HEADERS.AUTHORIZATION]: `Bearer ${sanitizeHeaderValue(this.config.apiKey)}`,
        [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
        'Idempotency-Key': `post-mortem-${req.incident_id}`
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [recipient],
        subject: req.title,
        html
      })
    });

    if (!isHttpSuccess(response.status)) {
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
