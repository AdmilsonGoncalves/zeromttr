import type { TargetHealthStatus } from '../domain/incident-enums.js';

export interface TargetLiveMetrics {
  requestsPerSecond: number;
  errorRate5xxPercent: number;
  p95LatencyMs: number;
  poolActive: number;
  poolWaiting: number;
  poolMax: number;
  healthyTrafficActive: boolean;
}

export interface TargetStatus {
  status: TargetHealthStatus | `${TargetHealthStatus}`;
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  rawEdgeLogPreCollector: string;
  metrics?: TargetLiveMetrics;
}

export interface TargetStatusPort {
  getStatus(): Promise<TargetStatus>;
}
