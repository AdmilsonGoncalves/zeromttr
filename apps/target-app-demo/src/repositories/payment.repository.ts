export class PaymentRepository {
  private waitingWaiters = 0;
  private pendingCleanups = new Set<() => void>();

  // Pool Configuration (Restored to Baseline v2.14.7: max 10)
  private healthyMaxConnections = 10;
  private degradedMaxConnections = 2;
  private acquireTimeoutMs = parseNumber(process.env.DB_ACQUIRE_TIMEOUT_MS, 150);

  // ... (existing code omitted for brevity, keeping all original class properties and methods intact)

  async createPayment(traceId: string, input: any) {
    const span = telemetry.startSpan('PaymentRepository.createPayment', { traceId });
    try {
      if (this.waitingWaiters >= this.degradedMaxConnections) {
        telemetry.endSpan(span, { code: SpanStatusCode.ERROR, message: 'Pool exhausted' });
        throw new Error('Pool exhausted');
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
      telemetry.endSpan(span, { code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    }
  }
}