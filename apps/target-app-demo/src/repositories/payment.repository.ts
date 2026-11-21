export class PaymentRepository {
  private waitingWaiters = 0;
  private pendingCleanups = new Set<() => void>();

  // Pool Configuration (Baseline v2.14.7 restored: max 10)
  private healthyMaxConnections = 10;
  private degradedMaxConnections = 2;
  private acquireTimeoutMs = parseNumber(process.env.DB_ACQUIRE_TIMEOUT_MS, 150);

  async createPayment(input: PaymentInput): Promise<Payment> {
    const traceId = telemetry.getCurrentTraceId();
    const span = telemetry.startSpan('HTTP POST /payments', { traceId });
    
    try {
      const client = await this.acquireConnection(traceId);
      try {
        const payment = await this.executePaymentInsert(client, input);
        telemetry.endSpan(span, { code: SpanStatusCode.OK });
        return payment;
      } finally {
        client.release();
      }
    } catch (err) {
      telemetry.endSpan(span, 
        { code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    }
  }
}