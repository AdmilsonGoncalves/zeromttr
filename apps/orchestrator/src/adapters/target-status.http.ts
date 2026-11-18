import { z } from 'zod';
import { buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import { OrchestratorDefault, TargetHealthStatus } from '../domain/index.js';
import type { TargetStatus, TargetStatusPort } from '../ports/index.js';

const TargetStatusSchema = z.object({
  status: z.enum([
    TargetHealthStatus.HEALTHY,
    TargetHealthStatus.DEGRADED,
    TargetHealthStatus.UNREACHABLE
  ]),
  service: z.string(),
  version: z.string(),
  previousHealthyVersion: z.string(),
  targetRepo: z.string(),
  suspectFilePath: z.string(),
  rawEdgeLogPreCollector: z.string()
});

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
        const parsed = TargetStatusSchema.safeParse(await response.json());
        if (parsed.success) {
          return parsed.data;
        }
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
}
