import type http from 'node:http';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { paymentService, PaymentService } from '../services/payment.service.js';

export class HealthController {
  public constructor(private service: PaymentService = paymentService) {}

  /**
   * Returns the current service health and connection pool status (`200` or `503` on failure).
   */
  public async getHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const health = await this.service.getHealth();
      res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } catch {
      res.writeHead(HTTP_STATUS.SERVICE_UNAVAILABLE, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unavailable', service: 'api-pagamentos-core' }));
    }
  }
}

export const healthController = new HealthController();
