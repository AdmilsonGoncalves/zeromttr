import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import { setupNock, cleanNock, teardownNock, mockResendSendEmail } from '../helpers/nock.helper.js';

describe('Tool: send_post_mortem_resend integration', () => {
  let server: http.Server;
  const incidentId = 'inc-postmortem-555';

  beforeAll(async () => {
    setupNock();
    await new Promise<void>((resolve) => {
      server = bootstrap(0);
      server.on('listening', () => resolve());
    });
  });

  afterAll(async () => {
    teardownNock();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    cleanNock();
  });

  it('should deliver post-mortem email via Resend with escaped HTML and HMAC links in #fragment', async () => {
    mockResendSendEmail({ emailId: 're_123456789' });

    const approveUrl = `http://localhost:4200/decision/${incidentId}#action=approve&sig=hmac_approve_sig_abc&exp=1700000900`;
    const rejectUrl = `http://localhost:4200/decision/${incidentId}#action=reject&sig=hmac_reject_sig_xyz&exp=1700000900`;

    const res = await callMcpTool(server, 'send_post_mortem_resend', {
      incident_id: incidentId,
      recipient_email: 'oncall-sre@example.com',
      title: `[POST-MORTEM] Incident ${incidentId} - api-pagamentos-core degraded`,
      rca_summary: 'Database connection leak in PaymentRepository caused pool exhaustion.',
      evidence_coverage: '4/4 Signals — 100%',
      reasoning_source: 'llm',
      blast_radius: ['api-pagamentos-core', 'postgres-db'],
      regression_commit: 'v2.14.7...v2.14.8',
      pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/99',
      approve_url: approveUrl,
      reject_url: rejectUrl,
      leaked_patterns_detected: 0
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.delivered).toBe(true);
    expect(data.id).toBe('re_123456789');
  });

  it('should return error when Resend API fails with 422', async () => {
    mockResendSendEmail({ status: 422 });

    const res = await callMcpTool(server, 'send_post_mortem_resend', {
      incident_id: incidentId,
      title: 'Title',
      rca_summary: 'RCA',
      evidence_coverage: '4/4',
      reasoning_source: 'fallback',
      blast_radius: ['service-a'],
      regression_commit: 'v2.14.7...v2.14.8',
      pull_request_url: 'https://github.com/pull/1',
      approve_url: 'http://localhost:4200/decision/1#action=approve&sig=abc&exp=1',
      reject_url: 'http://localhost:4200/decision/1#action=reject&sig=def&exp=1'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Resend send email failed: 422');
  });
});
