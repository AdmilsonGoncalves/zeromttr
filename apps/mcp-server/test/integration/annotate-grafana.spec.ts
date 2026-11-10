import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { callMcpTool } from '../helpers/mcp-client.helper.js';
import {
  setupNock,
  cleanNock,
  teardownNock,
  mockGrafanaAnnotation
} from '../helpers/nock.helper.js';

describe('Tool: annotate_grafana_incident integration', () => {
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

  it('should create an incident annotation on Grafana including aiops-remediation tag', async () => {
    mockGrafanaAnnotation('http://localhost:3000', { annotationId: 101 });

    const res = await callMcpTool(server, 'annotate_grafana_incident', {
      time: 1700000000000,
      text: 'ZeroMTTR: Autonomous Remediation PR opened #99',
      tags: ['incident-456', 'production'],
      pull_request_url: 'https://github.com/AdmilsonGoncalves/zeromttr/pull/99'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(false);

    const data = res.parsedContent;
    expect(data.id).toBe(101);
    expect(data.message).toBe('Annotation added');
  });

  it('should reject call when annotation text is empty', async () => {
    const res = await callMcpTool(server, 'annotate_grafana_incident', {
      text: ''
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Validation error');
  });

  it('should return error when Grafana returns 500 error', async () => {
    mockGrafanaAnnotation('http://localhost:3000', { status: 500 });

    const res = await callMcpTool(server, 'annotate_grafana_incident', {
      text: 'Incident resolved'
    });

    expect(res.status).toBe(200);
    expect(res.result?.isError).toBe(true);
    expect(res.result?.content[0].text).toContain('Grafana createAnnotation failed: 500');
  });
});
