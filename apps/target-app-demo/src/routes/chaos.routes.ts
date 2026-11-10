import type http from 'node:http';
import { chaosController } from '../controllers/index.js';

export function handleChaosRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL
): boolean {
  const pathname = parsedUrl.pathname;

  if (req.method === 'POST' && pathname === '/chaos/pool-saturation') {
    const enable = parsedUrl.searchParams.get('enable') || undefined;
    chaosController.togglePoolSaturation(req, res, enable);
    return true;
  }

  if (req.method === 'GET' && pathname === '/chaos/status') {
    chaosController.getStatus(req, res);
    return true;
  }

  return false;
}
