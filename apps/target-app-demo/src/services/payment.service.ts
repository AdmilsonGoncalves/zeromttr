import { chaosManager } from '../chaos/index.js';
import type { CreatePaymentInput, Payment } from '../models/index.js';
import { paymentRepository, PaymentRepository } from '../repositories/index.js';

export interface ServiceHealth {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: 'connected' | 'pool_saturated';
  pool: {
    active: number;
    waiting: number;
    max: number;
  };
}

export class PaymentService {
  public constructor(private repository: PaymentRepository = paymentRepository) {}

  public async createPayment(
    input: CreatePaymentInput,
    context?: { traceId?: string }
  ): Promise<Payment> {
    return this.repository.createPayment(input, context);
  }

  public async getPayment(id: string, traceId?: string): Promise<Payment | null> {
    return this.repository.getPaymentById(id, traceId);
  }

  public async getHealth(): Promise<ServiceHealth> {
    const isChaos = chaosManager.isPoolSaturationEnabled();
    const stats = this.repository.getPoolStats();
    const isPoolSaturated = isChaos || (stats.active >= stats.max && stats.max > 0);

    return {
      status: isPoolSaturated ? 'degraded' : 'ok',
      service: 'api-pagamentos-core',
      version: isChaos ? 'v2.14.8' : 'v2.14.7',
      database: isPoolSaturated ? 'pool_saturated' : 'connected',
      pool: stats
    };
  }
}

export const paymentService = new PaymentService();
