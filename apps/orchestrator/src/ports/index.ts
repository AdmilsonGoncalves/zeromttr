export interface IncidentPort {
  notify(): Promise<void>;
}

export * from './reasoning.port.js';
export * from './tools.port.js';
export * from './target-status.port.js';
export * from './incident-repository.port.js';
export * from './clock.port.js';
export * from './event-broadcaster.port.js';
