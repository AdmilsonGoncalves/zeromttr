import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bootstrap } from '../../src/main.js';
import { mcpConfig } from '../../src/config/index.js';

interface McpTestServer extends http.Server {
  getActiveSessionsCount?: () => number;
}

describe('MCP Multi-Session Streamable SSE Integration', () => {
  let server: McpTestServer;
  let baseUrl: string;
  let controller1: AbortController;
  let controller2: AbortController;

  beforeAll(async () => {
    controller1 = new AbortController();
    controller2 = new AbortController();
    await new Promise<void>((resolve) => {
      server = bootstrap(0) as McpTestServer;
      server.on('listening', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    controller1.abort();
    controller2.abort();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('should support two concurrent and independent MCP SSE sessions', async () => {
    const response1 = await fetch(`${baseUrl}/sse`, {
      headers: { Authorization: `Bearer ${mcpConfig.MCP_AUTH_TOKEN}` },
      signal: controller1.signal
    });

    const response2 = await fetch(`${baseUrl}/sse`, {
      headers: { Authorization: `Bearer ${mcpConfig.MCP_AUTH_TOKEN}` },
      signal: controller2.signal
    });

    expect(response1.status).toBe(200);
    expect(response1.headers.get('content-type')).toContain('text/event-stream');

    expect(response2.status).toBe(200);
    expect(response2.headers.get('content-type')).toContain('text/event-stream');

    // Read first chunk from stream 1 to get endpoint with sessionId
    const reader1 = response1.body?.getReader();
    const chunk1 = await reader1?.read();
    const text1 = new TextDecoder().decode(chunk1?.value);

    // Read first chunk from stream 2
    const reader2 = response2.body?.getReader();
    const chunk2 = await reader2?.read();
    const text2 = new TextDecoder().decode(chunk2?.value);

    expect(text1).toContain('event: endpoint');
    expect(text1).toContain('/mcp/messages?sessionId=');

    expect(text2).toContain('event: endpoint');
    expect(text2).toContain('/mcp/messages?sessionId=');

    // Extract sessionIds
    const sessionId1Match = text1.match(/sessionId=([a-zA-Z0-9-]+)/);
    const sessionId2Match = text2.match(/sessionId=([a-zA-Z0-9-]+)/);

    expect(sessionId1Match).not.toBeNull();
    expect(sessionId2Match).not.toBeNull();

    const sessionId1 = sessionId1Match![1];
    const sessionId2 = sessionId2Match![1];

    // Sessions must have unique and independent identifiers
    expect(sessionId1).not.toBe(sessionId2);

    // Verify active sessions on server
    const activeCount = server.getActiveSessionsCount?.();
    expect(activeCount).toBe(2);

    // Terminate session 1 and verify session 2 remains active
    controller1.abort();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const remainingCount = server.getActiveSessionsCount?.();
    expect(remainingCount).toBe(1);

    // Terminate session 2
    controller2.abort();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const finalCount = server.getActiveSessionsCount?.();
    expect(finalCount).toBe(0);
  });

  it('should automatically expire idle sessions when exceeding sessionTtlMs', async () => {
    let ttlServer: McpTestServer;
    await new Promise<void>((resolve) => {
      ttlServer = bootstrap(0, {
        serverOptions: {
          sessionTtlMs: 40,
          sessionCleanupIntervalMs: 20
        }
      }) as McpTestServer;
      ttlServer.on('listening', () => resolve());
    });

    const addr = ttlServer!.address() as AddressInfo;
    const ttlBaseUrl = `http://127.0.0.1:${addr.port}`;
    const ttlController = new AbortController();

    try {
      const sseRes = await fetch(`${ttlBaseUrl}/sse`, {
        headers: { Authorization: `Bearer ${mcpConfig.MCP_AUTH_TOKEN}` },
        signal: ttlController.signal
      });

      expect(sseRes.status).toBe(200);
      expect(ttlServer!.getActiveSessionsCount?.()).toBe(1);

      // Wait past the session TTL and sweeper interval
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(ttlServer!.getActiveSessionsCount?.()).toBe(0);
    } finally {
      ttlController.abort();
      if (typeof ttlServer!.closeAllConnections === 'function') {
        ttlServer!.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        ttlServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
