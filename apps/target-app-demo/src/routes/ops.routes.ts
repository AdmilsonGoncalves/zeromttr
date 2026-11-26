import type http from 'node:http';
import { chaosController } from '../controllers/chaos.controller.js';
import { OpsStatusController } from '../controllers/ops-status.controller.js';

const opsStatusController = new OpsStatusController(() => chaosController.isHealthyTrafficActive());

/**
 * Dispatches neutral operational manifest endpoints (`GET /ops/status`).
 */
export function handleOpsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL
): boolean {
  if (req.method === 'GET' && parsedUrl.pathname === '/ops/status') {
    opsStatusController.getStatus(req, res);
    return true;
  }

  return false;
}
