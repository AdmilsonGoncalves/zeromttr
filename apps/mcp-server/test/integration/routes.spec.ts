import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { makeRequest } from '../helpers/http.js';

describe('mcp-server routes integration', () => {
  let server: http.Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = bootstrap(0);
      server.on('listening', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('should return 200 with health status on /health', async () => {
    const res = await makeRequest(server, '/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      health: {
        healthy: true,
        status: 'ready'
      }
    });
  });

  it('should return 200 plain text on root /', async () => {
    const res = await makeRequest(server, '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('ZeroMTTR MCP Server Running');
  });

  it('should return 404 JSON for unknown routes', async () => {
    const res = await makeRequest(server, '/unknown-path');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
