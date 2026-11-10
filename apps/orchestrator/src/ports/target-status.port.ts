export interface TargetStatus {
  status: 'healthy' | 'degraded';
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  rawEdgeLogPreCollector: string;
}

export interface TargetStatusPort {
  getStatus(): Promise<TargetStatus>;
  triggerChaos(enable: boolean, delayMs?: number): Promise<void>;
  reset(): Promise<void>;
}
