import { buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import type { DemoControlPort } from './demo-control.port.js';

export class HttpDemoControlAdapter implements DemoControlPort {
  private readonly baseUrl: string;

  public constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.TARGET_APP_URL || 'http://localhost:3000';
  }

  public async triggerChaos(enable: boolean, delayMs = 4600): Promise<void> {
    const url = buildUrl(this.baseUrl, '/chaos/pool-saturation', {
      enable: String(enable),
      delay: String(delayMs)
    });
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    if (!isHttpSuccess(response.status)) {
      throw new Error(`Target app chaos trigger failed with status ${response.status}`);
    }
  }

  public async reset(): Promise<void> {
    const url = buildUrl(this.baseUrl, '/chaos/pool-saturation', {
      enable: 'false'
    });
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    if (!isHttpSuccess(response.status)) {
      throw new Error(`Target app chaos reset failed with status ${response.status}`);
    }
  }
}
