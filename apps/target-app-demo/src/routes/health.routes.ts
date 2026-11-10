import type http from 'node:http';
import { healthController } from '../controllers/health.controller.js';

export async function handleHealthRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    await healthController.getHealth(req, res);
    return true;
  }

  return false;
}
