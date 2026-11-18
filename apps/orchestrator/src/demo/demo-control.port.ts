export interface DemoControlPort {
  triggerChaos(enable: boolean, delayMs?: number): Promise<void>;
  reset(): Promise<void>;
}
