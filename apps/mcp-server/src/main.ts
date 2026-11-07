import http from 'node:http';
import { checkMcpApplicationHealth } from './application/index.js';
import { mcpConfig } from './config/index.js';

export function bootstrap(): http.Server {
  const health = checkMcpApplicationHealth();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', health }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ZeroMTTR MCP Server Running');
  });

  server.listen(mcpConfig.port, () => {
    console.log(`[mcp-server] Initialized on port ${mcpConfig.port}, status: ${health.status}`);
  });

  return server;
}

bootstrap();
