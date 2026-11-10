import crypto from 'node:crypto';
import { chaosManager } from '../chaos/index.js';
import type { CreatePaymentInput, Payment } from '../models/payment.model.js';
import { SpanStatusCode, telemetry } from '../telemetry/otel.js';

export class KnexTimeoutError extends Error {
  public constructor(
    message = 'Knex: Timeout acquiring a connection. The pool is probably full. Are you missing a .transacting(trx) call?'
  ) {
    super(message);
    this.name = 'KnexTimeoutError';
  }
}

export interface DbClient {
  id: string;
  release: () => void;
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

export class PaymentRepository {
  private payments = new Map<string, Payment>();
  private activeConnections = new Set<string>();
  private waitingWaiters = 0;
  private pendingCleanups = new Set<() => void>();

  // Pool Configuration (Baseline v2.14.7: max 10)
  private healthyMaxConnections = 10;
  private degradedMaxConnections = 2;
  private acquireTimeoutMs = Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 150;

  public getPoolStats(): { active: number; waiting: number; max: number } {
    const isChaos = chaosManager.isPoolSaturationEnabled();
    const max = isChaos ? this.degradedMaxConnections : this.healthyMaxConnections;
    return {
      active: this.activeConnections.size,
      waiting: this.waitingWaiters,
      max
    };
  }

  public resetPool(): void {
    const cleanups = Array.from(this.pendingCleanups);
    this.pendingCleanups.clear();
    for (const cancel of cleanups) {
      try {
        cancel();
      } catch {
        // Ignore
      }
    }
    this.activeConnections.clear();
    this.waitingWaiters = 0;
    telemetry.recordPoolUsed(0);
    telemetry.recordPoolWaiting(0);
  }

  public async acquireConnection(traceId?: string): Promise<DbClient> {
    const isChaos = chaosManager.isPoolSaturationEnabled();
    const maxConnections = isChaos ? this.degradedMaxConnections : this.healthyMaxConnections;
    const acquireSpan = telemetry.startSpan('pg.pool.acquire', { traceId });

    if (this.activeConnections.size < maxConnections) {
      const clientId = crypto.randomUUID();
      this.activeConnections.add(clientId);
      telemetry.recordPoolUsed(this.activeConnections.size);

      telemetry.endSpan(acquireSpan, { code: SpanStatusCode.OK });
      return this.createClient(clientId);
    }

    // Pool saturated — queue up and wait
    this.waitingWaiters++;
    telemetry.recordPoolWaiting(this.waitingWaiters);

    try {
      const acquiredClient = await new Promise<DbClient>((resolve, reject) => {
        let isDone = false;

        const cleanup = () => {
          if (!isDone) {
            isDone = true;
            clearTimeout(timeout);
            clearInterval(checkInterval);
            this.pendingCleanups.delete(cancel);
          }
        };

        const cancel = () => {
          if (isDone) {
            return;
          }
          cleanup();
          this.waitingWaiters = Math.max(0, this.waitingWaiters - 1);
          telemetry.recordPoolWaiting(this.waitingWaiters);
          reject(new Error('Connection pool was reset while waiting for a connection'));
        };

        const timeout = setTimeout(() => {
          cleanup();
          this.waitingWaiters = Math.max(0, this.waitingWaiters - 1);
          telemetry.recordPoolWaiting(this.waitingWaiters);

          const err = new KnexTimeoutError();
          reject(err);
        }, this.acquireTimeoutMs);

        const checkInterval = setInterval(() => {
          if (this.activeConnections.size < maxConnections && !isDone) {
            cleanup();
            this.waitingWaiters = Math.max(0, this.waitingWaiters - 1);
            telemetry.recordPoolWaiting(this.waitingWaiters);

            const clientId = crypto.randomUUID();
            this.activeConnections.add(clientId);
            telemetry.recordPoolUsed(this.activeConnections.size);

            telemetry.endSpan(acquireSpan, { code: SpanStatusCode.OK });
            resolve(this.createClient(clientId));
          }
        }, 10);

        this.pendingCleanups.add(cancel);
      });

      return acquiredClient;
    } catch (error) {
      telemetry.endSpan(acquireSpan, {
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Pool acquire failed'
      });
      throw error;
    }
  }

  public async createPayment(
    input: CreatePaymentInput,
    context?: { traceId?: string }
  ): Promise<Payment> {
    const traceId = context?.traceId || telemetry.generateTraceId();
    const span = telemetry.startSpan('PaymentRepository.createPayment', {
      traceId,
      attributes: {
        'db.system': 'postgresql',
        'db.operation': 'INSERT',
        'db.table': 'payments'
      }
    });

    const isChaos = chaosManager.isPoolSaturationEnabled();

    try {
      if (isChaos) {
        // --- DEGRADED BEHAVIOR (Release v2.14.8 with CHAOS_ENABLED=true) ---
        // Reduced pool (max 2) + omission of client.release() when latency or timeout occurs.
        const client = await this.acquireConnection(traceId);

        // Artificially delay execution under chaos to simulate high concurrency backlog
        const delay = chaosManager.getArtificialDelayMs();
        const effectiveDelay = process.env.NODE_ENV === 'test' ? Math.min(delay, 250) : delay;
        await new Promise((resolve) => setTimeout(resolve, effectiveDelay));

        const payment = await this.executePaymentInsert(client, input);

        // NOTE: In the v2.14.8 regression commit ("perf(db): inline payment lock query on high concurrency"),
        // client.release() was omitted, leaking database connections!
        // (client.release() is intentionally omitted here in degraded mode)

        telemetry.endSpan(span, { code: SpanStatusCode.OK });
        return payment;
      } else {
        // --- HEALTHY BASELINE (Release v2.14.7) ---
        // Knex pool max: 10, strictly releasing connections in try { ... } finally { client.release() }
        const client = await this.acquireConnection(traceId);
        try {
          const payment = await this.executePaymentInsert(client, input);
          telemetry.endSpan(span, { code: SpanStatusCode.OK });
          return payment;
        } finally {
          client.release();
        }
      }
    } catch (err) {
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : 'Failed to create payment'
      });

      // Emit synthetic PII error log matching TECH 03 specification
      const txId = `TX-${Math.floor(1000 + Math.random() * 9000)}`;
      const logBody = `ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #${txId} for payer CPF ${input.payerCpf} merchant CNPJ ${input.merchantCnpj} pixKey ${input.pixKey} auth ${input.authHeader || 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'}`;

      telemetry.emitLog('ERROR', logBody, {
        traceId,
        spanId: span.spanId,
        attributes: {
          'pix.key': input.pixKey,
          'pix.txId': txId,
          'error.type': err instanceof KnexTimeoutError ? 'KnexTimeoutError' : 'DatabaseError'
        }
      });

      throw err;
    }
  }

  public async getPaymentById(id: string, traceId?: string): Promise<Payment | null> {
    const client = await this.acquireConnection(traceId);
    try {
      return this.payments.get(id) || null;
    } finally {
      client.release();
    }
  }

  private createClient(clientId: string): DbClient {
    return {
      id: clientId,
      release: () => {
        this.activeConnections.delete(clientId);
        telemetry.recordPoolUsed(this.activeConnections.size);
      },
      query: async <T = unknown>(_sql: string, _params?: unknown[]) => {
        return { rows: [] as T[] };
      }
    };
  }

  private async executePaymentInsert(
    _client: DbClient,
    input: CreatePaymentInput
  ): Promise<Payment> {
    const id = crypto.randomUUID();
    const txId = `TX-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const payment: Payment = {
      id,
      txId,
      amount: input.amount,
      currency: input.currency || 'BRL',
      status: 'completed',
      payerCpf: input.payerCpf,
      merchantCnpj: input.merchantCnpj,
      pixKey: input.pixKey,
      description: input.description || 'PIX Payment Transaction',
      createdAt: now,
      updatedAt: now
    };

    this.payments.set(id, payment);
    return payment;
  }
}

export const paymentRepository = new PaymentRepository();
