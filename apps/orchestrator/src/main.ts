import http from 'node:http';
import { createInitialIncident } from './application/index.js';

export function bootstrap(): http.Server {
  const incident = createInitialIncident();
  const port = Number(process.env.PORT) || 8080;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', incident }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ZeroMTTR Orchestrator Running');
  });

  server.listen(port, () => {
    console.log(`[orchestrator] Initialized with state ${incident.state} on port ${port}`);
  });

  return server;
}

bootstrap();
