import type http from 'node:http';
import { paymentService, PaymentService } from '../services/payment.service.js';

export class HealthController {
  public constructor(private service: PaymentService = paymentService) {}

  public async getHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const health = await this.service.getHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unavailable', service: 'api-pagamentos-core' }));
    }
  }
}

export const healthController = new HealthController();
