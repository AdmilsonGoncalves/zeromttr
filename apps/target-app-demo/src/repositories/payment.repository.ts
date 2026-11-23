export class PaymentRepository {
  private waitingWaiters = 0;
  private pendingCleanups = new Set<() => void>();

  // Pool Configuration (Baseline restored: max 10)
  private healthyMaxConnections = 10;
  private degradedMaxConnections = 2;
  private acquireTimeoutMs = parseNumber(process.env.DB_ACQUIRE_TIMEOUT_MS, 150);

  public async processPayment(traceId: string, input: any): Promise<any> {
    const span = telemetry.startSpan('PaymentRepository.processPayment', { traceId });
    try {
      if (this.waitingWaiters > this.degradedMaxConnections) {
        telemetry.endSpan(span, { code: SpanStatusCode.OK });
        return null;
      } else {
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
        message: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }
}