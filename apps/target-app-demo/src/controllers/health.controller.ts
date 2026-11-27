import type http from 'node:http';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { TargetHealthState, TargetServiceIdentity } from '../chaos/target-metadata-enums.js';
import { paymentService, PaymentService } from '../services/payment.service.js';

/**
 * HTTP controller serving the target workload's health and database pool saturation status.
 */
export class HealthController {
  public constructor(private service: PaymentService = paymentService) {}

  /**
   * Returns the current service health and connection pool status (`200` or `503` on failure).
   */
  public async getHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const health = await this.service.getHealth();
      res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
      res.end(JSON.stringify(health));
    } catch {
      res.writeHead(HTTP_STATUS.SERVICE_UNAVAILABLE, {
        [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON
      });
      res.end(
        JSON.stringify({
          status: TargetHealthState.UNAVAILABLE,
          service: TargetServiceIdentity.SERVICE_NAME
        })
      );
    }
  }
}

export const healthController = new HealthController();
