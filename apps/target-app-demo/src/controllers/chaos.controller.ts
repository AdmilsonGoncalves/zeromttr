import type http from 'node:http';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosManager } from '../chaos/index.js';
import { paymentRepository } from '../repositories/index.js';

export class ChaosController {
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

  public getStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const status = chaosManager.getStatus();
    res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }
}

export const chaosController = new ChaosController();
