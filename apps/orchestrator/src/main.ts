import http from 'node:http';
import { createInitialIncident } from './application/index.js';

export function bootstrap(port: number = Number(process.env.PORT) || 8080): http.Server {
  const incident = createInitialIncident();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', incident }));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ZeroMTTR Orchestrator Running');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    console.log(`[orchestrator] Initialized with state ${incident.state} on port ${port}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
