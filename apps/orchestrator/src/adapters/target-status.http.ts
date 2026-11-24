import { z } from 'zod';
import { buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import { OrchestratorDefault, TargetHealthStatus } from '../domain/incident-enums.js';
import { resolveTargetRepoUrl } from '../domain/target-repo-url.js';
import type { TargetStatus, TargetStatusPort } from '../ports/target-status.port.js';

const TargetLiveMetricsSchema = z.object({
  requestsPerSecond: z.number().nonnegative(),
  errorRate5xxPercent: z.number().min(0).max(100),
  p95LatencyMs: z.number().nonnegative(),
  poolActive: z.number().int().nonnegative(),
  poolWaiting: z.number().int().nonnegative(),
  poolMax: z.number().int().nonnegative(),
  healthyTrafficActive: z.boolean()
});

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
  rawEdgeLogPreCollector: z.string(),
  metrics: TargetLiveMetricsSchema.optional()
});

/**
 * HTTP adapter polling the target workload's status endpoint with an unreachable fallback.
 */
export class HttpTargetStatusAdapter implements TargetStatusPort {
  private readonly baseUrl: string;

  public constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ||
      process.env.TARGET_APP_URL ||
      process.env.TARGET_DEMO_URL ||
      'http://localhost:3000';
  }

  /**
   * Queries the target app's chaos status endpoint, falling back to `UNREACHABLE` on failure.
   */
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
      targetRepo: resolveTargetRepoUrl(),
      suspectFilePath: process.env.TARGET_SUSPECT_FILE_PATH || '',
      rawEdgeLogPreCollector: ''
    };
  }
}
