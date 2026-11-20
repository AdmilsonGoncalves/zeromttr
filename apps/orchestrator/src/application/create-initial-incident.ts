import { getIncidentInitialState } from '../domain/incident-state.js';

/**
 * Builds the default initial incident payload exposed by the orchestrator health check.
 */
export function createInitialIncident(): { id: string; state: string } {
  const initial = getIncidentInitialState();
  return {
    id: 'inc-init-001',
    state: initial.state
  };
}
