import { buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import type { TargetStatus, TargetStatusPort } from '../ports/index.js';

export class HttpTargetStatusAdapter implements TargetStatusPort {
  private readonly baseUrl: string;

  public constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.TARGET_APP_URL || 'http://localhost:3000';
  }

  public async getStatus(): Promise<TargetStatus> {
    try {
      const url = buildUrl(this.baseUrl, '/chaos/status');
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (isHttpSuccess(response.status)) {
        return (await response.json()) as TargetStatus;
      }
    } catch {
      // Fallback if target app is offline
    }

    return {
      status: 'healthy',
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector:
        'ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
    };
  }

  public async triggerChaos(enable: boolean, delayMs = 4600): Promise<void> {
    try {
      const url = buildUrl(this.baseUrl, '/chaos/pool-saturation', {
        enable: String(enable),
        delay: String(delayMs)
      });
      await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    } catch {
      // Non-fatal if offline
    }
  }

  public async reset(): Promise<void> {
    try {
      const url = buildUrl(this.baseUrl, '/chaos/pool-saturation', {
        enable: 'false'
      });
      await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    } catch {
      // Non-fatal if offline
    }
  }
}
