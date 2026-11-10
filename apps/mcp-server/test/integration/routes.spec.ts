import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import { bootstrap } from '../../src/main.js';
import { makeRequest } from '../helpers/http.js';
import { mcpConfig } from '../../src/config/index.js';

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

  it('should return 401 Unauthorized for unknown routes without auth token', async () => {
    const res = await makeRequest(server, '/unknown-path');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized',
      message: 'Invalid or missing Authorization header'
    });
  });

  it('should return 404 JSON for unknown routes with valid auth token', async () => {
    const res = await makeRequest(server, '/unknown-path', {
      headers: {
        Authorization: `Bearer ${mcpConfig.MCP_AUTH_TOKEN}`
      }
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('should return 413 Payload Too Large when request body exceeds 1 MiB on POST /mcp', async () => {
    // Generate a payload larger than 1 MiB
    const oversizedBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      data: 'x'.repeat(1024 * 1024 + 100)
    });

    const res = await makeRequest(server, '/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpConfig.MCP_AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: oversizedBody
    });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: 'Payload too large'
    });
  });
});
