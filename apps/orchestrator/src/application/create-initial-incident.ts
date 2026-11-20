import { getIncidentInitialState } from '../domain/incident-state.js';

export function createInitialIncident(): { id: string; state: string } {
  const initial = getIncidentInitialState();
  return {
    id: 'inc-init-001',
    state: initial.state
  };
}
