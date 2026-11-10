import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry.js';
import { handleAuthMiddleware } from './auth.js';
import { logger } from './logger.js';
import { checkMcpApplicationHealth } from '../application/index.js';

export interface McpServerOptions {
  authToken: string;
  toolRegistry: ToolRegistry;
  sessionTtlMs?: number;
  sessionCleanupIntervalMs?: number;
}

export interface McpSession {
  sessionId: string;
  server: Server;
  transport: SSEServerTransport;
  createdAt: number;
  lastAccessedAt: number;
}

export function createMcpHttpServer(options: McpServerOptions): http.Server {
  const { authToken, toolRegistry } = options;
  const sessions = new Map<string, McpSession>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const requestId = randomUUID();
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = reqUrl.pathname;

      logger.debug({ requestId, method: req.method, url: req.url }, 'Incoming HTTP request');

      // Health check
      if (pathname === '/health' && req.method === 'GET') {
        const health = checkMcpApplicationHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', health }));
        return;
      }

      // Root check
      if (pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ZeroMTTR MCP Server Running');
        return;
      }

      // Authentication check
      if (!handleAuthMiddleware(req, res, authToken)) {
        logger.warn({ requestId, url: req.url }, 'Unauthorized request rejected');
        return;
      }

      // SSE Endpoint (GET /sse or GET /mcp)
      if (req.method === 'GET' && (pathname === '/sse' || pathname === '/mcp')) {
        try {
          const transport = new SSEServerTransport('/mcp/messages', res);
          const sessionId = transport.sessionId;

          const sessionServer = new Server(
            { name: 'zeromttr-aiops', version: '1.0.0' },
            { capabilities: { tools: {} } }
          );

          sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
            const currentSession = sessions.get(sessionId);
            if (currentSession) {
              currentSession.lastAccessedAt = Date.now();
            }
            return { tools: toolRegistry.listTools() };
          });

          sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            const currentSession = sessions.get(sessionId);
            if (currentSession) {
              currentSession.lastAccessedAt = Date.now();
            }
            const result = await toolRegistry.callTool(
              request.params.name,
              request.params.arguments
            );
            return {
              content: result.content,
              isError: result.isError
            };
          });

          const now = Date.now();
          const session: McpSession = {
            sessionId,
            server: sessionServer,
            transport,
            createdAt: now,
            lastAccessedAt: now
          };

          sessions.set(sessionId, session);
          logger.info(
            { requestId, sessionId, activeSessions: sessions.size },
            'New MCP SSE session created'
          );

          res.on('close', () => {
            sessions.delete(sessionId);
            logger.info(
              { requestId, sessionId, activeSessions: sessions.size },
              'MCP SSE session closed'
            );
          });

          await sessionServer.connect(transport);
          return;
        } catch (err) {
          logger.error({ requestId, err }, 'Failed to initialize MCP SSE connection');
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to initialize SSE connection' }));
          }
          return;
        }
      }

      // SSE Messages POST Endpoint (/mcp/messages?sessionId=...)
      if (req.method === 'POST' && pathname === '/mcp/messages') {
        const sessionId = reqUrl.searchParams.get('sessionId');
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found or expired' }));
          return;
        }

        const session = sessions.get(sessionId)!;
        session.lastAccessedAt = Date.now();
        await session.transport.handlePostMessage(req, res);
        return;
      }

      // Direct Streamable HTTP / JSON-RPC (POST /mcp)
      if (req.method === 'POST' && (pathname === '/mcp' || pathname === '/mcp/')) {
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        let isTooLarge = false;
        const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB payload cap

        req.on('data', (chunk: Buffer | string) => {
          if (isTooLarge) {
            return;
          }
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodyBytes += buf.length;
          if (bodyBytes > MAX_BODY_BYTES) {
            isTooLarge = true;
            req.pause();
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Payload too large',
                message: 'Request body exceeds 1 MiB limit'
              })
            );
            res.on('finish', () => req.destroy());
            return;
          }
          chunks.push(buf);
        });

        req.on('end', () => {
          if (isTooLarge) {
            return;
          }

          void (async () => {
            const bodyText = Buffer.concat(chunks).toString('utf-8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(bodyText);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: { code: -32700, message: 'Parse error' }
                })
              );
              return;
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: {
                    code: -32600,
                    message: 'Invalid Request: body must be a JSON-RPC object'
                  }
                })
              );
              return;
            }

            const body = parsed as {
              id?: string | number | null;
              method?: string;
              params?: { name?: string; arguments?: Record<string, unknown> };
            };

            const id = body.id ?? null;

            if (body.method === 'tools/list') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: { tools: toolRegistry.listTools() }
                })
              );
              return;
            }

            if (body.method === 'tools/call') {
              const toolName = body.params?.name;
              const toolArgs = body.params?.arguments;
              if (!toolName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32602, message: 'Missing tool name in params' }
                  })
                );
                return;
              }
              const result = await toolRegistry.callTool(toolName, toolArgs);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result
                })
              );
              return;
            }

            if (body.method === 'initialize') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'zeromttr-aiops', version: '1.0.0' },
                    capabilities: { tools: {} }
                  }
                })
              );
              return;
            }

            if (body.method === 'ping') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${body.method}` }
              })
            );
          })().catch((err: unknown) => {
            logger.error({ err }, 'Error handling /mcp request');
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: { code: -32603, message: 'Internal error' }
                })
              );
            }
          });
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    })().catch((err: unknown) => {
      logger.error({ err }, 'Unhandled request error');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });
  });

  // Session cleanup TTL sweeper (default 30 min)
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  const cleanupIntervalMs = options.sessionCleanupIntervalMs ?? 60_000;
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastAccessedAt > sessionTtlMs) {
        logger.info({ sessionId: id }, 'Expiring idle MCP SSE session');
        sessions.delete(id);
        void session.server
          .close()
          .catch((err) =>
            logger.warn({ sessionId: id, err }, 'Failed to close session server on expiry')
          );
        void session.transport
          .close()
          .catch((err) =>
            logger.warn({ sessionId: id, err }, 'Failed to close session transport on expiry')
          );
      }
    }
  }, cleanupIntervalMs);
  cleanupInterval.unref();

  server.on('close', () => {
    clearInterval(cleanupInterval);
    for (const [id, session] of sessions.entries()) {
      void session.server
        .close()
        .catch((err) =>
          logger.warn({ sessionId: id, err }, 'Failed to close session server on shutdown')
        );
      void session.transport
        .close()
        .catch((err) =>
          logger.warn({ sessionId: id, err }, 'Failed to close session transport on shutdown')
        );
    }
    sessions.clear();
  });

  // Attach session count inspector for tests and monitoring
  (server as unknown as { getActiveSessionsCount: () => number }).getActiveSessionsCount = () =>
    sessions.size;

  return server;
}
