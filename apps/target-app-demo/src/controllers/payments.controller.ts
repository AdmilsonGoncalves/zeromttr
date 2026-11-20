import type http from 'node:http';
import { CreatePaymentSchema } from '../models/payment.model.js';
import { KnexTimeoutError } from '../repositories/payment.repository.js';
import { paymentService, PaymentService } from '../services/payment.service.js';
import { SpanStatusCode, telemetry } from '../telemetry/otel.js';
import { durationInSeconds, isNonEmptyString, toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';

export class PaymentsController {
  public constructor(private service: PaymentService = paymentService) {}

  /**
   * Validates the payment request body, delegates creation, and records trace spans and HTTP latency metrics.
   */
  public async createPayment(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown
  ): Promise<void> {
    const startTime = Date.now();
    const rawTraceHeader = req.headers['x-trace-id'];
    const traceId = isNonEmptyString(rawTraceHeader) ? rawTraceHeader : telemetry.generateTraceId();
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
        const durationSec = durationInSeconds(startTime);
        telemetry.recordHttpServerDuration(durationSec, traceId);
        telemetry.endSpan(span, {
          code: SpanStatusCode.ERROR,
          message: 'Validation failed'
        });
        res.writeHead(HTTP_STATUS.BAD_REQUEST, {
          'Content-Type': 'application/json',
          'x-trace-id': traceId
        });
        res.end(JSON.stringify({ error: 'Validation failed', details: parsed.error.issues }));
        return;
      }

      // Process payment
      const payment = await this.service.createPayment(parsed.data, { traceId });

      const durationSec = durationInSeconds(startTime);
      telemetry.recordHttpServerDuration(durationSec, traceId);
      telemetry.endSpan(span, { code: SpanStatusCode.OK });

      res.writeHead(HTTP_STATUS.CREATED, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(JSON.stringify(payment));
    } catch (error) {
      const durationSec = durationInSeconds(startTime);
      telemetry.recordHttpServerDuration(durationSec, traceId);

      const isPoolTimeout = error instanceof KnexTimeoutError;
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: toErrorMessage(error, 'Internal Server Error')
      });

      const statusCode = isPoolTimeout
        ? HTTP_STATUS.SERVICE_UNAVAILABLE
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;
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

  /**
   * Looks up a payment by ID while recording OpenTelemetry spans and request duration metrics.
   */
  public async getPayment(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    paymentId: string
  ): Promise<void> {
    const startTime = Date.now();
    const rawTraceHeader = req.headers['x-trace-id'];
    const traceId = isNonEmptyString(rawTraceHeader) ? rawTraceHeader : telemetry.generateTraceId();
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
      const durationSec = durationInSeconds(startTime);
      telemetry.recordHttpServerDuration(durationSec, traceId);

      if (!payment) {
        telemetry.endSpan(span, {
          code: SpanStatusCode.ERROR,
          message: 'Payment not found'
        });
        res.writeHead(HTTP_STATUS.NOT_FOUND, {
          'Content-Type': 'application/json',
          'x-trace-id': traceId
        });
        res.end(JSON.stringify({ error: 'Payment not found' }));
        return;
      }

      telemetry.endSpan(span, { code: SpanStatusCode.OK });
      res.writeHead(HTTP_STATUS.OK, {
        'Content-Type': 'application/json',
        'x-trace-id': traceId
      });
      res.end(JSON.stringify(payment));
    } catch (error) {
      const durationSec = durationInSeconds(startTime);
      telemetry.recordHttpServerDuration(durationSec, traceId);

      const isPoolTimeout = error instanceof KnexTimeoutError;
      telemetry.endSpan(span, {
        code: SpanStatusCode.ERROR,
        message: toErrorMessage(error, 'Internal Server Error')
      });

      const statusCode = isPoolTimeout
        ? HTTP_STATUS.SERVICE_UNAVAILABLE
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;
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
