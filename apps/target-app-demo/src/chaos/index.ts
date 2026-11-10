export interface ChaosStatus {
  status: 'healthy' | 'degraded';
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  rawEdgeLogPreCollector: string;
}

export const RAW_EDGE_LOG_SAMPLE =
  'ERROR [api-pagamentos-core] Pool exhausted processing PIX transaction #TX-9042 for payer CPF 123.456.789-00 merchant CNPJ 12.345.678/0001-99 pixKey cliente.silva@exemplo.com.br auth Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';

export class ChaosManager {
  private poolSaturation = false;
  private artificialDelayMs = 4600;

  public constructor() {
    if (process.env.CHAOS_ENABLED === 'true') {
      this.poolSaturation = true;
    }
  }

  public isPoolSaturationEnabled(): boolean {
    return this.poolSaturation;
  }

  public setPoolSaturation(enabled: boolean, delayMs = 4600): void {
    this.poolSaturation = enabled;
    if (typeof delayMs === 'number' && Number.isFinite(delayMs) && delayMs >= 0) {
      this.artificialDelayMs = Math.min(Math.max(delayMs, 0), 60000);
    } else {
      this.artificialDelayMs = 4600;
    }
  }

  public getArtificialDelayMs(): number {
    return this.artificialDelayMs;
  }

  public getStatus(): ChaosStatus {
    const isDegraded = this.poolSaturation;
    return {
      status: isDegraded ? 'degraded' : 'healthy',
      service: 'api-pagamentos-core',
      version: isDegraded ? 'v2.14.8' : 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: RAW_EDGE_LOG_SAMPLE
    };
  }

  public reset(): void {
    this.poolSaturation = false;
    this.artificialDelayMs = 4600;
  }
}

export const chaosManager = new ChaosManager();
