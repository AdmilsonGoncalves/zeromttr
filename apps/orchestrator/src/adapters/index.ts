import type { IncidentPort } from '../ports/index.js';

export class BaseIncidentAdapter implements IncidentPort {
  async notify(): Promise<void> {
    return Promise.resolve();
  }
}

export * from './llm.fallback.js';
export * from './llm.gemini.js';
export * from './mcp.client.js';
export * from './repo.file.js';
export * from './target-status.http.js';
