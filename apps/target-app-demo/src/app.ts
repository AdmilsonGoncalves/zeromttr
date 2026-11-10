import type http from 'node:http';
import { handleChaosRoutes } from './routes/chaos.routes.js';
import { handleHealthRoutes } from './routes/health.routes.js';
import { handlePaymentsRoutes } from './routes/payments.routes.js';
import { initTelemetry } from './telemetry/otel.js';

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Basic response defaults
  res.setHeader('X-Service', 'api-pagamentos-core');

  const host = req.headers.host || 'localhost:3001';
  const parsedUrl = new URL(req.url || '/', `http://${host}`);

  // Parse body if present
  let body: unknown = undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const rawBody = await new Promise<string>((resolve, reject) => {
        let chunks = '';
        req.on('data', (chunk) => {
          chunks += chunk;
        });
        req.on('end', () => resolve(chunks));
        req.on('error', (err) => reject(err));
      });

      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }
  }

  // Route dispatch
  if (handleChaosRoutes(req, res, parsedUrl)) {
    return;
  }

  if (await handleHealthRoutes(req, res, parsedUrl)) {
    return;
  }

  if (await handlePaymentsRoutes(req, res, parsedUrl, body)) {
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ZeroMTTR Target Demo Workload Running');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

export function createApp(): http.RequestListener {
  initTelemetry();

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error('[target-app-demo] unhandled request error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });
  };
}
