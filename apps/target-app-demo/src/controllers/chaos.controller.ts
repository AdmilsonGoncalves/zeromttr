import type http from 'node:http';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosManager } from '../chaos/chaos.manager.js';
import { paymentRepository } from '../repositories/payment.repository.js';

export class ChaosController {
  /**
   * Toggles pool saturation chaos mode, resets the pool on recovery, and responds with updated status.
   */
  public togglePoolSaturation(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    enableParam?: string
  ): void {
    const shouldEnable = enableParam === 'true';
    chaosManager.setPoolSaturation(shouldEnable);

    if (!shouldEnable) {
      paymentRepository.resetPool();
    }

    res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        poolSaturation: shouldEnable,
        status: chaosManager.getStatus()
      })
    );
  }

  /**
   * Responds with the current target app chaos status JSON payload.
   */
  public getStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const status = chaosManager.getStatus();
    res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }
}

export const chaosController = new ChaosController();
