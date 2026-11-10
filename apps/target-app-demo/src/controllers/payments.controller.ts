import type http from 'node:http';
import { CreatePaymentSchema } from '../models/payment.model.js';
import { KnexTimeoutError } from '../repositories/payment.repository.js';
import { paymentService, PaymentService } from '../services/payment.service.js';
import { SpanStatusCode, telemetry } from '../telemetry/otel.js';

export class PaymentsController {
  public constructor(private service: PaymentService = paymentService) {}

  public async createPayment(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown
  ): Promise<void> {
    const startTime = Date.now();
    const traceId = (req.headers['x-trace-id'] as string) || telemetry.generateTraceId();
    const span = telemetry.startSpan('HTTP POST /payments', {
      traceId,
      attributes: {
        'http.method': 'POST',
        'http.route': '/payments',
        'http.user_agent': req.headers['user-agent'] || 'unknown'
      }
    });

    try {
      const parsed = CreatePaymentSchema.safeParse(body);
      if (!parsed.success) {
        const durationSec = (Date.now() - startTime) / 1000;
        telemetry.recordHttpServerDuration(durationSec, traceId);
        telemetry.endSpan(span, {
          code: SpanStatusCode.ERROR,
          message: 'Validation failed'
        });
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'x-trace-id': traceId
        });
        res.end(JSON.stringify({ error: 'Validation failed', details: parsed.error.issues }));
        return;
      }

      // Process payment
      const payment = await this.service.createPayment(parsed.data, { traceId });

      const durationSec = (Date.now() - startTime) / 1000;
      telemetry.recordHttpServerDuration(durationSec, traceId);
      telemetry.endSpan(span, { code: SpanStatusCode.OK });

      res.writeHead(201, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(JSON.stringify(payment));
    } catch (error) {
      const durationSec = (Date.now() - startTime) / 1000;
      telemetry.recordHttpServerDuration(durationSec, traceId);

      const isPoolTimeout = error instanceof KnexTimeoutError;
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Internal Server Error'
      });

      const statusCode = isPoolTimeout ? 503 : 500;
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(
        JSON.stringify({
          error: isPoolTimeout
            ? 'Knex: Timeout acquiring a connection. The pool is probably full. Are you missing a .transacting(trx) call?'
            : 'Internal Server Error',
          code: isPoolTimeout ? 'KnexTimeoutError' : 'InternalError',
          service: 'api-pagamentos-core'
        })
      );
    }
  }

  public async getPayment(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    paymentId: string
  ): Promise<void> {
    const startTime = Date.now();
    const traceId = (req.headers['x-trace-id'] as string) || telemetry.generateTraceId();
    const span = telemetry.startSpan('HTTP GET /payments/:id', {
      traceId,
      attributes: {
        'http.method': 'GET',
        'http.route': '/payments/:id',
        'payment.id': paymentId
      }
    });

    try {
      const payment = await this.service.getPayment(paymentId, traceId);
      const durationSec = (Date.now() - startTime) / 1000;
      telemetry.recordHttpServerDuration(durationSec, traceId);

      if (!payment) {
        telemetry.endSpan(span, {
          code: SpanStatusCode.ERROR,
          message: 'Payment not found'
        });
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'x-trace-id': traceId
        });
        res.end(JSON.stringify({ error: 'Payment not found' }));
        return;
      }

      telemetry.endSpan(span, { code: SpanStatusCode.OK });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(JSON.stringify(payment));
    } catch (error) {
      const durationSec = (Date.now() - startTime) / 1000;
      telemetry.recordHttpServerDuration(durationSec, traceId);

      const isPoolTimeout = error instanceof KnexTimeoutError;
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Internal Server Error'
      });

      const statusCode = isPoolTimeout ? 503 : 500;
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(
        JSON.stringify({
          error: isPoolTimeout
            ? 'Knex: Timeout acquiring a connection. The pool is probably full. Are you missing a .transacting(trx) call?'
            : 'Internal Server Error',
          code: isPoolTimeout ? 'KnexTimeoutError' : 'InternalError',
          service: 'api-pagamentos-core'
        })
      );
    }
  }
}

export const paymentsController = new PaymentsController();
