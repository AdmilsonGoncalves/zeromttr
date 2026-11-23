import type http from 'node:http';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosManager } from '../chaos/chaos.manager.js';
import { paymentRepository } from '../repositories/payment.repository.js';

/**
 * HTTP controller exposing chaos pool-saturation toggles and target status inspection endpoints.
 */
export class ChaosController {
  private activeBurstTimers: NodeJS.Timeout[] = [];

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
      this.stopSyntheticTrafficBurst();
      paymentRepository.resetPool();
    } else if (process.env.DEMO_MODE === 'true') {
      this.startSyntheticTrafficBurst();
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

  private stopSyntheticTrafficBurst(): void {
    for (const timer of this.activeBurstTimers) {
      clearTimeout(timer);
    }
    this.activeBurstTimers = [];
  }

  private startSyntheticTrafficBurst(): void {
    this.stopSyntheticTrafficBurst();
    const port = process.env.PORT || '3001';
    const targetUrl = `http://127.0.0.1:${port}/payments`;
    const syntheticPayload = JSON.stringify({
      amount: 149.9,
      currency: 'BRL',
      payerCpf: '123.456.789-00',
      merchantCnpj: '12.345.678/0001-99',
      pixKey: 'cliente.silva@exemplo.com.br',
      description: 'PIX Settlement Burst #TX-9042',
      authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
    });

    const fireWave = (): void => {
      if (!chaosManager.isPoolSaturationEnabled()) {
        return;
      }
      for (let i = 0; i < 6; i++) {
        void fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: syntheticPayload
        }).catch(() => undefined);
      }
    };

    fireWave();
    for (const delayMs of [3000, 6000, 9000, 12000, 15000]) {
      const timer = setTimeout(fireWave, delayMs);
      timer.unref();
      this.activeBurstTimers.push(timer);
    }
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
