import type { TargetHealthStatus } from '../domain/incident-enums.js';

export interface TargetCapabilities {
  chaosSimulation: boolean;
  healthyTrafficToggle: boolean;
}

export interface TargetSaturation {
  resourceLabel: string;
  active: number;
  waiting: number;
  max: number;
}

export interface TargetLiveMetrics {
  requestsPerSecond: number;
  errorRate5xxPercent: number;
  p95LatencyMs: number;
  healthyTrafficActive: boolean;
  saturation?: TargetSaturation;
  poolActive?: number;
  poolWaiting?: number;
  poolMax?: number;
}

export interface TargetStatus {
  status: TargetHealthStatus | `${TargetHealthStatus}`;
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  capabilities?: TargetCapabilities;
  rawEdgeLogPreCollector: string;
  metrics?: TargetLiveMetrics;
}

export interface TargetStatusPort {
  getStatus(): Promise<TargetStatus>;
}
