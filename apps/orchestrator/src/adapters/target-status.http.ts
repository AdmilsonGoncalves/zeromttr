import { buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import { OrchestratorDefault, TargetHealthStatus } from '../domain/index.js';
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
      status: TargetHealthStatus.UNREACHABLE,
      service: process.env.TARGET_SERVICE_NAME || OrchestratorDefault.UNKNOWN_SERVICE,
      version: OrchestratorDefault.UNKNOWN,
      previousHealthyVersion: OrchestratorDefault.UNKNOWN,
      targetRepo: process.env.TARGET_REPO_URL || '',
      suspectFilePath: process.env.TARGET_SUSPECT_FILE_PATH || '',
      rawEdgeLogPreCollector: ''
    };
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
