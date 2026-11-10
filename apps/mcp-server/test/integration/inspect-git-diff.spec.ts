import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import {
  setupNock,
  cleanNock,
  teardownNock,
  mockGithubCompare,
  mockGithubGetContents
} from '../helpers/nock.helper.js';

describe('Tool: inspect_git_deploy_diff integration', () => {
  let server: http.Server;

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

  it('should compare releases, sanitize PII, extract blob_sha and compute FinOps telemetry', async () => {
    mockGithubCompare('AdmilsonGoncalves/zeromttr', 'v2.14.7', 'v2.14.8', {
      authorLogin: 'admilson-dev',
      commitMessage:
        'fix: regression pool acquire\n\nCo-authored-by: External Dev <ext.dev@private.corp>\nSigned-off-by: CI'
    });

    mockGithubGetContents(
      'AdmilsonGoncalves/zeromttr',
      'apps/target-app-demo/src/repositories/payment.repository.ts',
      'v2.14.8',
      {
        sha: 'sha-blob-payment-repo-123',
        content: 'export class PaymentRepository { async pay() { /* leak */ } }'
      }
    );

    const res = await callMcpTool(server, 'inspect_git_deploy_diff', {
      base_ref: 'v2.14.7',
      head_ref: 'v2.14.8',
      service_path: 'apps/target-app-demo',
      suspect_keyword: 'payment.repository.ts'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.base_ref).toBe('v2.14.7');
    expect(data.head_ref).toBe('v2.14.8');

    // Strict Anti-PII sanitization check
    expect(data.author_login).toBe('admilson-dev');
    expect(data.commit_message).not.toContain('ext.dev@private.corp');
    expect(data.commit_message).not.toContain('Co-authored-by:');
    expect(data.commit_message).toContain('fix: regression pool acquire');

    // Suspect file & blob sha check
    expect(data.suspect_file).toBeDefined();
    expect(data.suspect_file.blob_sha).toBe('sha-blob-payment-repo-123');
    expect(data.suspect_file.content).toContain('PaymentRepository');

    // FinOps Telemetry check
    expect(data.raw_bytes_fetched).toBeGreaterThan(0);
    expect(data.compacted_bytes_sent_to_llm).toBeGreaterThan(0);
    expect(data.payload_reduction_percent).toBeGreaterThan(0);
    expect(data.estimated_tokens_saved).toBeGreaterThan(0);
  });

  it('should return error when GitHub compare returns 404 for unknown tag', async () => {
    mockGithubCompare('AdmilsonGoncalves/zeromttr', 'unknown-tag', 'v2.14.8', {
      status: 404
    });

    const res = await callMcpTool(server, 'inspect_git_deploy_diff', {
      base_ref: 'unknown-tag',
      head_ref: 'v2.14.8'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('GitHub compare failed: 404');
  });
});
