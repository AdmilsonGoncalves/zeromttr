import type http from 'node:http';
import { paymentsController } from '../controllers/index.js';

export async function handlePaymentsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedUrl: URL,
  body: unknown
): Promise<boolean> {
  const pathname = parsedUrl.pathname;

  if (req.method === 'POST' && pathname === '/payments') {
    await paymentsController.createPayment(req, res, body);
    return true;
  }

  const paymentIdMatch = pathname.match(/^\/payments\/([^/]+)$/);
  if (req.method === 'GET' && paymentIdMatch) {
    const paymentId = paymentIdMatch[1];
    await paymentsController.getPayment(req, res, paymentId);
    return true;
  }

  return false;
}
