import http from 'node:http';
import { initTelemetry } from './telemetry/index.js';

export function bootstrap(): http.Server {
  initTelemetry();
  const port = Number(process.env.PORT) || 3001;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'api-pagamentos-core' }));
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ZeroMTTR Target Demo Workload Running');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => {
    console.log(`[target-app-demo] api-pagamentos-core listening on port ${port}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}
