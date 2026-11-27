import type http from 'node:http';
import { performance } from 'node:perf_hooks';
import { isNonEmptyString, safeJsonParse } from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { TargetHttpHeader, TargetServiceIdentity } from './chaos/target-metadata-enums.js';
import { handleChaosRoutes } from './routes/chaos.routes.js';
import { handleHealthRoutes } from './routes/health.routes.js';
import { handleOpsRoutes } from './routes/ops.routes.js';
import { handlePaymentsRoutes } from './routes/payments.routes.js';
import { initTelemetry } from './telemetry/otel.js';
import { requestMetrics } from './telemetry/request-metrics.js';

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Basic response defaults
  res.setHeader(TargetHttpHeader.SERVICE, TargetServiceIdentity.SERVICE_NAME);

  const host = req.headers.host || 'localhost:3001';
  const parsedUrl = new URL(req.url || '/', `http://${host}`);

  const shouldTrackMetrics =
    !parsedUrl.pathname.startsWith('/chaos/') &&
    !parsedUrl.pathname.startsWith('/ops/') &&
    parsedUrl.pathname !== '/health';
  if (shouldTrackMetrics) {
    const startedAt = performance.now();
    res.once('finish', () => {
      requestMetrics.record(performance.now() - startedAt, res.statusCode);
    });
  }

  // Parse body if present
  let body: unknown = undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const MAX_BODY_BYTES = 1024 * 1024;
      const rawBody = await new Promise<string>((resolve, reject) => {
        let chunks = '';
        let totalBytes = 0;
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          totalBytes += Buffer.byteLength(chunk, 'utf8');
          if (totalBytes > MAX_BODY_BYTES) {
            reject(new Error('Request body too large'));
            req.destroy();
            return;
          }
          chunks += chunk;
        });
        req.on('end', () => resolve(chunks));
        req.on('error', (err) => reject(err));
      });

      if (isNonEmptyString(rawBody)) {
        body = safeJsonParse(rawBody, rawBody);
      }
    } catch {
      res.writeHead(HTTP_STATUS.BAD_REQUEST, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }
  }

  // Route dispatch
  if (handleOpsRoutes(req, res, parsedUrl)) {
    return;
  }

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
    res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.TEXT_PLAIN });
    res.end('ZeroMTTR Target Demo Workload Running');
    return;
  }

  res.writeHead(HTTP_STATUS.NOT_FOUND, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

/**
 * Initializes telemetry and returns the Node HTTP request listener for `target-app-demo`.
 */
export function createApp(): http.RequestListener {
  initTelemetry();

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error('[target-app-demo] unhandled request error', error);
      if (!res.headersSent) {
        res.writeHead(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
          [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON
        });
      }
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });
  };
}
