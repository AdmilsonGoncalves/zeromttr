import type { McpPort } from '../ports/index.js';

export class BaseMcpAdapter implements McpPort {
  async execute(): Promise<void> {
    return Promise.resolve();
  }
}
