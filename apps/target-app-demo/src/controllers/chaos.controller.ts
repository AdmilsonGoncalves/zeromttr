import type http from 'node:http';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosManager } from '../chaos/chaos.manager.js';
import { paymentRepository } from '../repositories/payment.repository.js';
import { buildTargetStatusManifest } from './ops-status.controller.js';
import { telemetry } from '../telemetry/otel.js';

const HEALTHY_TRAFFIC_INTERVAL_MS = 1500;
const HEALTHY_TRAFFIC_BATCH_SIZE = 2;

/**
 * HTTP controller exposing chaos pool-saturation toggles, healthy traffic generation, and target status inspection endpoints.
 */
export class ChaosController {
  private activeBurstTimers: NodeJS.Timeout[] = [];
  private healthyTrafficTimer: NodeJS.Timeout | null = null;
  private healthyTrafficActive = false;

  /**
   * Toggles pool saturation chaos mode, resets the pool on recovery, and responds with updated status.
   */
  public togglePoolSaturation(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    enableParam?: string
  ): void {
    const shouldEnable = enableParam === 'true';

    if (!shouldEnable) {
      this.stopSyntheticTrafficBurst();
      // Reset while degraded version is still active so v2.14.8 gauges drop to 0 in Prometheus
      paymentRepository.resetPool();
    }

    chaosManager.setPoolSaturation(shouldEnable);

    if (!shouldEnable) {
      telemetry.recordPoolUsed(0);
      telemetry.recordPoolWaiting(0);
    } else if (this.isAutoTrafficBurstEnabled()) {
      this.startSyntheticTrafficBurst();
    }

    res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
    res.end(
      JSON.stringify({
        success: true,
        poolSaturation: shouldEnable,
        status: this.buildStatusPayload()
      })
    );
  }

  /**
   * Starts or stops continuous healthy synthetic traffic against `POST /payments`.
   */
  public toggleHealthyTraffic(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    enableParam?: string
  ): void {
    const shouldEnable = enableParam === 'true';
    if (shouldEnable) {
      this.startHealthyTraffic();
    } else {
      this.stopHealthyTraffic();
    }

    res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
    res.end(
      JSON.stringify({
        success: true,
        healthyTrafficActive: this.healthyTrafficActive,
        status: this.buildStatusPayload()
      })
    );
  }

  /**
   * Stops continuous healthy traffic (useful for graceful shutdown and test teardown).
   */
  public stopHealthyTraffic(): void {
    if (this.healthyTrafficTimer) {
      clearInterval(this.healthyTrafficTimer);
      this.healthyTrafficTimer = null;
    }
    this.healthyTrafficActive = false;
  }

  private startHealthyTraffic(): void {
    if (this.healthyTrafficActive && this.healthyTrafficTimer) {
      return;
    }

    this.stopHealthyTraffic();
    this.healthyTrafficActive = true;

    const fireHealthyWave = (): void => {
      if (!this.healthyTrafficActive) {
        return;
      }
      const port = process.env.PORT || '3001';
      const targetUrl = `http://127.0.0.1:${port}/payments`;
      const payload = this.buildSyntheticPaymentPayload('PIX Healthy Stream #OK');

      for (let i = 0; i < HEALTHY_TRAFFIC_BATCH_SIZE; i++) {
        void fetch(targetUrl, {
          method: 'POST',
          headers: { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON },
          body: payload
        }).catch(() => undefined);
      }
    };

    fireHealthyWave();
    this.healthyTrafficTimer = setInterval(fireHealthyWave, HEALTHY_TRAFFIC_INTERVAL_MS);
    this.healthyTrafficTimer.unref();
  }

  private stopSyntheticTrafficBurst(): void {
    for (const timer of this.activeBurstTimers) {
      clearTimeout(timer);
    }
    this.activeBurstTimers = [];
  }

  private buildSyntheticPaymentPayload(description: string): string {
    return JSON.stringify({
      amount: 149.9,
      currency: 'BRL',
      payerCpf: '123.456.789-00',
      merchantCnpj: '12.345.678/0001-99',
      pixKey: 'cliente.silva@exemplo.com.br',
      description,
      authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
    });
  }

  private startSyntheticTrafficBurst(): void {
    this.stopSyntheticTrafficBurst();
    const port = process.env.PORT || '3001';
    const targetUrl = `http://127.0.0.1:${port}/payments`;
    const syntheticPayload = this.buildSyntheticPaymentPayload('PIX Settlement Burst #TX-9042');

    const fireWave = (): void => {
      if (!chaosManager.isPoolSaturationEnabled()) {
        return;
      }
      for (let i = 0; i < 6; i++) {
        void fetch(targetUrl, {
          method: 'POST',
          headers: { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON },
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
   * Returns whether continuous healthy synthetic traffic is currently active.
   */
  public isHealthyTrafficActive(): boolean {
    return this.healthyTrafficActive;
  }

  private isAutoTrafficBurstEnabled(): boolean {
    if (process.env.CHAOS_AUTO_TRAFFIC_BURST !== undefined) {
      return process.env.CHAOS_AUTO_TRAFFIC_BURST === 'true';
    }
    return process.env.DEMO_MODE === 'true';
  }

  private buildStatusPayload() {
    return buildTargetStatusManifest(this.healthyTrafficActive);
  }

  /**
   * Responds with the current target app chaos status JSON payload.
   */
  public getStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
    res.end(JSON.stringify(this.buildStatusPayload()));
  }
}

export const chaosController = new ChaosController();
