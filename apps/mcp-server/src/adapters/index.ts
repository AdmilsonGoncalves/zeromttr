import type { McpPort } from '../ports/index.js';

export * from './prometheus.http.js';
export * from './loki.http.js';
export * from './tempo.http.js';
export * from './github-inspector.http.js';
export * from './github-remediation.http.js';
export * from './resend.http.js';
export * from './grafana-annotations.http.js';

export class BaseMcpAdapter implements McpPort {
  async execute(): Promise<void> {
    return Promise.resolve();
  }
}
