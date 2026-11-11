import type { ReasoningPort, CollectedEvidence, RcaAndPatchSynthesis } from '../ports/index.js';

export const HEALTHY_PAYMENT_REPOSITORY_PATCH = `import crypto from 'node:crypto';
import { chaosManager } from '../chaos/index.js';
import type { CreatePaymentInput, Payment } from '../models/index.js';
import { SpanStatusCode, telemetry } from '../telemetry/index.js';
import { toErrorMessage } from '@zeromttr/utils';

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
  private degradedMaxConnections = 10;
  private acquireTimeoutMs = Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 150;

  public getPoolStats(): { active: number; waiting: number; max: number } {
    return {
      active: this.activeConnections.size,
      waiting: this.waitingWaiters,
      max: this.healthyMaxConnections
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
    const acquireSpan = telemetry.startSpan('pg.pool.acquire', { traceId });

    if (this.activeConnections.size < this.healthyMaxConnections) {
      const clientId = crypto.randomUUID();
      this.activeConnections.add(clientId);
      telemetry.recordPoolUsed(this.activeConnections.size);

      telemetry.endSpan(acquireSpan, { code: SpanStatusCode.OK });
      return this.createClient(clientId);
    }

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
          if (this.activeConnections.size < this.healthyMaxConnections && !isDone) {
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
        message: toErrorMessage(error, 'Pool acquire failed')
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

    const client = await this.acquireConnection(traceId);
    try {
      const payment = await this.executePaymentInsert(client, input);
      telemetry.endSpan(span, { code: SpanStatusCode.OK });
      return payment;
    } catch (err) {
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: toErrorMessage(err, 'Failed to create payment')
      });
      throw err;
    } finally {
      client.release();
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
    const txId = \`TX-\${Math.floor(1000 + Math.random() * 9000)}\`;
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
`;

export class DeterministicFallbackReasoningAdapter implements ReasoningPort {
  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    const evidenceRefs = [
      evidence.traceAnalysis?.traceId,
      'http_server_duration_milliseconds_bucket',
      evidence.gitDiff?.suspectCommit
    ].filter(Boolean) as string[];

    return {
      summary:
        'Degradação crítica de latência decorrente de saturação do pool de conexões do banco de dados.',
      rootCause:
        'A release v2.14.8 reduziu o pool de conexões para max: 2 e omitiu a liberação de conexões via client.release() em transações que sofrem timeout, provocando KnexTimeoutError.',
      evidenceRefs,
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patchedContent: HEALTHY_PAYMENT_REPOSITORY_PATCH,
      explanation:
        "O patch restaura o bloco 'finally { client.release(); }' e o dimensionamento do pool para max: 10 baseado na versão saudável v2.14.7.",
      reasoningSource: 'fallback'
    };
  }
}
