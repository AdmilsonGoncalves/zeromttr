import type http from 'node:http';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosController } from '../controllers/chaos.controller.js';
import { areChaosEndpointsEnabled } from '../controllers/ops-status.controller.js';

function sendChaosDisabledResponse(res: http.ServerResponse): void {
  res.writeHead(HTTP_STATUS.FORBIDDEN, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
  res.end(
    JSON.stringify({
      code: 'CHAOS_ENDPOINTS_DISABLED',
      error: 'Chaos simulation endpoints are disabled in this environment.'
    })
  );
}

/**
 * Dispatches `/chaos/pool-saturation`, `/chaos/healthy-traffic`, and `/chaos/status` HTTP routes to `ChaosController`.
 */
export function handleChaosRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL
): boolean {
  const pathname = parsedUrl.pathname;

  if (req.method === 'POST' && pathname === '/chaos/pool-saturation') {
    if (!areChaosEndpointsEnabled()) {
      sendChaosDisabledResponse(res);
      return true;
    }
    const enable = parsedUrl.searchParams.get('enable') || undefined;
    chaosController.togglePoolSaturation(req, res, enable);
    return true;
  }

  if (req.method === 'POST' && pathname === '/chaos/healthy-traffic') {
    if (!areChaosEndpointsEnabled()) {
      sendChaosDisabledResponse(res);
      return true;
    }
    const enable = parsedUrl.searchParams.get('enable') || undefined;
    chaosController.toggleHealthyTraffic(req, res, enable);
    return true;
  }

  if (req.method === 'GET' && pathname === '/chaos/status') {
    chaosController.getStatus(req, res);
    return true;
  }

  return false;
}
