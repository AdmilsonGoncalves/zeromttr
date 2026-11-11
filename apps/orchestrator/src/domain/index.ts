export const ORCHESTRATOR_DOMAIN_VERSION = '1.0.0';

export function getIncidentInitialState(): { state: string; version: string } {
  return {
    state: 'RECEIVED',
    version: ORCHESTRATOR_DOMAIN_VERSION
  };
}
