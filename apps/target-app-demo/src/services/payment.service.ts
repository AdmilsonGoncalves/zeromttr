import { chaosManager } from '../chaos/chaos.manager.js';
import { TargetReleaseVersion, TargetServiceIdentity } from '../chaos/target-metadata-enums.js';
import type { CreatePaymentInput, Payment } from '../models/payment.model.js';
import { paymentRepository, PaymentRepository } from '../repositories/payment.repository.js';

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
      service: TargetServiceIdentity.SERVICE_NAME,
      version: isChaos ? TargetReleaseVersion.DEGRADED : TargetReleaseVersion.HEALTHY,
      database: isPoolSaturated ? 'pool_saturated' : 'connected',
      pool: stats
    };
  }
}

export const paymentService = new PaymentService();
