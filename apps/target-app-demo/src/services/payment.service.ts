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

/**
 * Service layer coordinating PIX payment persistence and aggregated database pool health reporting.
 */
export class PaymentService {
  public constructor(private repository: PaymentRepository = paymentRepository) {}

  /**
   * Delegates payment creation to the repository with optional trace context.
   */
  public async createPayment(
    input: CreatePaymentInput,
    context?: { traceId?: string }
  ): Promise<Payment> {
    return this.repository.createPayment(input, context);
  }

  /**
   * Retrieves a payment record by ID from the repository.
   */
  public async getPayment(id: string, traceId?: string): Promise<Payment | null> {
    return this.repository.getPaymentById(id, traceId);
  }

  /**
   * Aggregates chaos state and pool saturation metrics into a service health snapshot.
   */
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

  /**
   * Exposes current database connection pool statistics through the service boundary.
   */
  public getPoolStats(): { active: number; waiting: number; max: number } {
    return this.repository.getPoolStats();
  }
}

export const paymentService = new PaymentService();
