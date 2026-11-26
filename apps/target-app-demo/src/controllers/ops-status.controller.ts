import type http from 'node:http';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { chaosManager } from '../chaos/chaos.manager.js';
import type { TargetOpsStatus } from '../chaos/target-metadata-enums.js';
import { paymentService } from '../services/payment.service.js';
import { requestMetrics } from '../telemetry/request-metrics.js';

export interface TargetOpsCapabilities {
  chaosSimulation: boolean;
  healthyTrafficToggle: boolean;
}

export interface TargetOpsSaturation {
  resourceLabel: string;
  active: number;
  waiting: number;
  max: number;
}

export interface TargetOpsStatusManifest {
  status: TargetOpsStatus;
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  capabilities: TargetOpsCapabilities;
  rawEdgeLogPreCollector: string;
  metrics: {
    requestsPerSecond: number;
    errorRate5xxPercent: number;
    p95LatencyMs: number;
    healthyTrafficActive: boolean;
    saturation: TargetOpsSaturation;
    poolActive: number;
    poolWaiting: number;
    poolMax: number;
  };
}

function areChaosEndpointsEnabled(): boolean {
  if (process.env.CHAOS_ENDPOINTS_ENABLED !== undefined) {
    return process.env.CHAOS_ENDPOINTS_ENABLED === 'true';
  }
  if (process.env.ENABLE_DEMO_MODE !== undefined) {
    return process.env.ENABLE_DEMO_MODE === 'true';
  }
  return true;
}

/**
 * Builds the neutral operational status manifest including capabilities and generic saturation metrics.
 */
export function buildTargetStatusManifest(healthyTrafficActive: boolean): TargetOpsStatusManifest {
  const pool = paymentService.getPoolStats();
  const snapshot = requestMetrics.getSnapshot();
  const chaosEnabled = areChaosEndpointsEnabled();

  return {
    ...chaosManager.getStatus(),
    capabilities: {
      chaosSimulation: chaosEnabled,
      healthyTrafficToggle: chaosEnabled
    },
    metrics: {
      requestsPerSecond: snapshot.requestsPerSecond,
      errorRate5xxPercent: snapshot.errorRate5xxPercent,
      p95LatencyMs: snapshot.p95LatencyMs,
      healthyTrafficActive,
      saturation: {
        resourceLabel: 'DB Pool',
        active: pool.active,
        waiting: pool.waiting,
        max: pool.max
      },
      poolActive: pool.active,
      poolWaiting: pool.waiting,
      poolMax: pool.max
    }
  };
}

/**
 * HTTP controller serving the neutral `GET /ops/status` operational manifest.
 */
export class OpsStatusController {
  public constructor(private readonly isHealthyTrafficActive: () => boolean) {}

  /**
   * Responds with the neutral operational status JSON manifest.
   */
  public getStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(HTTP_STATUS.OK, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
    res.end(JSON.stringify(buildTargetStatusManifest(this.isHealthyTrafficActive())));
  }
}
