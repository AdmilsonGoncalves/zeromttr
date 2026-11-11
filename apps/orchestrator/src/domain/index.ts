export const ORCHESTRATOR_DOMAIN_VERSION = '1.0.0';

export function getIncidentInitialState(): { state: string; version: string } {
  return {
    state: 'RECEIVED',
    version: ORCHESTRATOR_DOMAIN_VERSION
  };
}

export * from './incident-state.js';
export * from './fingerprint.js';
export * from './pii-prompt-guard.patterns.js';
export * from './pii-prompt-guard.js';
export * from './evidence-coverage.js';
export * from './decision-hmac.js';
export * from './rca-report.js';
export * from './incident.js';
