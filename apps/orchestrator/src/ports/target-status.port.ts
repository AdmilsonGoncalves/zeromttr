import type { TargetHealthStatus } from '../domain/incident-enums.js';

export interface TargetStatus {
  status: TargetHealthStatus | `${TargetHealthStatus}`;
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  rawEdgeLogPreCollector: string;
}

export interface TargetStatusPort {
  getStatus(): Promise<TargetStatus>;
}
