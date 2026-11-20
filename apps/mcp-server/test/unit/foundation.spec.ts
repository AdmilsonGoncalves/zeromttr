import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import nock from 'nock';
import { getMcpDomainStatus } from '../../src/domain/index.js';
import { checkMcpApplicationHealth } from '../../src/application/index.js';
import { GrafanaAnnotationsHttpAdapter } from '../../src/adapters/grafana-annotations.http.js';
import { ResendHttpAdapter } from '../../src/adapters/resend.http.js';

describe('mcp-server foundation', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  it('should return ready status from domain layer', () => {
    const status = getMcpDomainStatus();
    expect(status.status).toBe('ready');
    expect(status.version).toBe('1.0.0');
  });

  it('should check application health based on domain', () => {
    const health = checkMcpApplicationHealth();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe('ready');
  });

  it('should_use_basic_auth_when_grafana_api_token_is_missing', async () => {
    const expectedBasic = Buffer.from('admin:secret', 'utf-8').toString('base64');
    const scope = nock('http://localhost:3000')
      .post('/api/annotations')
      .matchHeader('Authorization', `Basic ${expectedBasic}`)
      .reply(200, { id: 13 });

    const adapter = new GrafanaAnnotationsHttpAdapter({
      baseUrl: 'http://localhost:3000',
      apiToken: '',
      basicAuth: { username: 'admin', password: 'secret' }
    });

    const receipt = await adapter.createAnnotation({
      text: 'Test Basic Auth annotation',
      tags: ['test']
    });

    expect(receipt.id).toBe(13);
    expect(scope.isDone()).toBe(true);
  });

  it('should_reject_basic_auth_over_non_local_http_grafana_url', async () => {
    const adapter = new GrafanaAnnotationsHttpAdapter({
      baseUrl: 'http://grafana.remote.example.com:3000',
      apiToken: '',
      basicAuth: { username: 'admin', password: 'secret' }
    });

    await expect(
      adapter.createAnnotation({
        text: 'Should be blocked over plaintext remote HTTP',
        tags: ['test']
      })
    ).rejects.toThrow(/Refusing to send Grafana Basic credentials/);
  });

  it('should_fallback_to_default_recipient_in_resend_adapter', async () => {
    let capturedBody: { to?: string[] } | undefined;
    const scope = nock('https://api.resend.com')
      .post('/emails', (body) => {
        capturedBody = body as { to?: string[] };
        return true;
      })
      .reply(200, { id: 're_default_1' });

    const adapter = new ResendHttpAdapter({
      apiKey: 're_test_123',
      from: 'ZeroMTTR <noreply@example.com>',
      defaultRecipient: 'oncall-default@example.com'
    });

    const receipt = await adapter.sendPostMortem({
      incident_id: 'inc-default-1',
      title: 'Default recipient test',
      rca_summary: 'RCA summary',
      evidence_coverage: '4/4',
      reasoning_source: 'fallback',
      blast_radius: ['api-pagamentos-core'],
      regression_commit: 'v2.14.7...v2.14.8',
      pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/1',
      approve_url: 'http://localhost:4200/decision/inc-default-1#action=approve&sig=a&exp=1',
      reject_url: 'http://localhost:4200/decision/inc-default-1#action=reject&sig=b&exp=1'
    });

    expect(receipt.delivered).toBe(true);
    expect(capturedBody?.to).toEqual(['oncall-default@example.com']);
    expect(scope.isDone()).toBe(true);
  });
});
