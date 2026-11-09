import http from 'node:http';
import { checkMcpApplicationHealth } from './application/index.js';
import { mcpConfig } from './config/index.js';

export function bootstrap(port: number = mcpConfig.port): http.Server {
  const health = checkMcpApplicationHealth();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', health }));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ZeroMTTR MCP Server Running');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    console.log(`[mcp-server] Initialized on port ${port}, status: ${health.status}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
