import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import {
  setupNock,
  cleanNock,
  teardownNock,
  mockGithubRemediationFlow
} from '../helpers/nock.helper.js';

describe('Tool: create_remediation_pr integration', () => {
  let server: http.Server;
  const incidentId = 'inc-autonomous-999';

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

  it('should autonomously create hotfix branch, commit fix and open Pull Request with reasoning_source', async () => {
    mockGithubRemediationFlow('AdmilsonGoncalves/zeromttr', incidentId, 'release/target-v2.14.8');

    const res = await callMcpTool(server, 'create_remediation_pr', {
      incident_id: incidentId,
      file_path: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patched_content: 'export class PaymentRepository { async pay() { client.release(); } }',
      blob_sha: 'blob-sha-on-branch',
      title:
        'fix(target-app-demo): release db client in finally block [incident inc-autonomous-999]',
      rca_markdown: '### Root Cause Analysis\nConnection pool exhausted due to omitted release.',
      reasoning_source: 'llm'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.branchName).toBe(`hotfix/zeromttr-${incidentId}`);
    expect(data.branchUrl).toContain(`hotfix/zeromttr-${incidentId}`);
    expect(data.pullRequestUrl).toBe('https://github.com/AdmilsonGoncalves/zeromttr/pull/99');
    expect(data.commitSha).toBe('commit-sha-hotfix-789');
  });

  it('should reject invalid reasoning_source (only llm or fallback allowed)', async () => {
    const res = await callMcpTool(server, 'create_remediation_pr', {
      incident_id: incidentId,
      file_path: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patched_content: 'patched content',
      title: 'title',
      rca_markdown: 'rca',
      reasoning_source: 'unknown-engine'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Validation error');
  });
});
