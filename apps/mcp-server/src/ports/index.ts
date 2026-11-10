export * from './metrics.port.js';
export * from './logs.port.js';
export * from './traces.port.js';
export * from './repo-inspector.port.js';
export * from './remediation.port.js';
export * from './notifier.port.js';
export * from './annotation.port.js';

export interface McpPort {
  execute(): Promise<void>;
}
