import { TargetStatusResponseSchema, type TargetStatusResponse } from '@zeromttr/contracts';
import { isFilled } from '@zeromttr/utils';
import { HTTP_STATUS, buildUrl, isHttpSuccess } from '@zeromttr/utils/http';
import { OrchestratorDefault, TargetHealthStatus } from '../domain/incident-enums.js';
import { resolveTargetRepoUrl } from '../domain/target-repo-url.js';
import type {
  TargetLiveMetrics,
  TargetStatus,
  TargetStatusPort
} from '../ports/target-status.port.js';

const DEFAULT_OPS_STATUS_PATH = '/ops/status';
const LEGACY_CHAOS_STATUS_PATH = '/chaos/status';

function normalizeMetrics(metrics: TargetStatusResponse['metrics']): TargetLiveMetrics | undefined {
  if (!metrics) {
    return undefined;
  }

  let saturation = metrics.saturation;
  if (!saturation && [metrics.poolActive, metrics.poolWaiting, metrics.poolMax].every(isFilled)) {
    saturation = {
      resourceLabel: 'DB Pool',
      active: metrics.poolActive ?? 0,
      waiting: metrics.poolWaiting ?? 0,
      max: metrics.poolMax ?? 0
    };
  }

  return {
    requestsPerSecond: metrics.requestsPerSecond,
    errorRate5xxPercent: metrics.errorRate5xxPercent,
    p95LatencyMs: metrics.p95LatencyMs,
    healthyTrafficActive: metrics.healthyTrafficActive,
    ...(saturation ? { saturation } : {}),
    ...(isFilled(metrics.poolActive) ? { poolActive: metrics.poolActive } : {}),
    ...(isFilled(metrics.poolWaiting) ? { poolWaiting: metrics.poolWaiting } : {}),
    ...(isFilled(metrics.poolMax) ? { poolMax: metrics.poolMax } : {})
  };
}

/**
 * HTTP adapter polling the target workload's status manifest with legacy fallback and unreachable recovery.
 */
export class HttpTargetStatusAdapter implements TargetStatusPort {
  private readonly baseUrl: string;
  private readonly statusPath: string;

  public constructor(baseUrl?: string, statusPath?: string) {
    this.baseUrl =
      baseUrl ||
      process.env.TARGET_APP_URL ||
      process.env.TARGET_DEMO_URL ||
      'http://localhost:3000';
    this.statusPath = statusPath || process.env.TARGET_STATUS_PATH || DEFAULT_OPS_STATUS_PATH;
  }

  private async fetchAndParse(path: string): Promise<{ status: number; data?: TargetStatus }> {
    const url = buildUrl(this.baseUrl, path);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!isHttpSuccess(response.status)) {
      return { status: response.status };
    }

    const parsed = TargetStatusResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: response.status };
    }

    const payload = parsed.data;
    return {
      status: response.status,
      data: {
        status: payload.status,
        service: payload.service,
        version: payload.version,
        previousHealthyVersion: payload.previousHealthyVersion,
        targetRepo: payload.targetRepo ?? resolveTargetRepoUrl(),
        suspectFilePath: payload.suspectFilePath ?? process.env.TARGET_SUSPECT_FILE_PATH ?? '',
        capabilities: payload.capabilities,
        rawEdgeLogPreCollector: payload.rawEdgeLogPreCollector ?? '',
        metrics: normalizeMetrics(payload.metrics)
      }
    };
  }

  /**
   * Queries the configured target status endpoint, falling back to `/chaos/status` on 404 and `UNREACHABLE` on failure.
   */
  public async getStatus(): Promise<TargetStatus> {
    try {
      const primary = await this.fetchAndParse(this.statusPath);
      if (primary.data) {
        return primary.data;
      }

      if (
        primary.status === HTTP_STATUS.NOT_FOUND &&
        this.statusPath !== LEGACY_CHAOS_STATUS_PATH
      ) {
        const legacy = await this.fetchAndParse(LEGACY_CHAOS_STATUS_PATH);
        if (legacy.data) {
          return legacy.data;
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
      capabilities: {
        chaosSimulation: false,
        healthyTrafficToggle: false
      },
      rawEdgeLogPreCollector: ''
    };
  }
}
