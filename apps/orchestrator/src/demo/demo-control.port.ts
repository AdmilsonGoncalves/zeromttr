export interface DemoControlPort {
  triggerChaos(enable: boolean, delayMs?: number): Promise<void>;
  toggleHealthyTraffic(enable: boolean): Promise<void>;
  reset(): Promise<void>;
}
