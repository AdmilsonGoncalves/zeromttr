import { getIncidentInitialState } from '../domain/index.js';

export function createInitialIncident(): { id: string; state: string } {
  const initial = getIncidentInitialState();
  return {
    id: 'inc-init-001',
    state: initial.state
  };
}

export * from './handle-alert.js';
export * from './investigate-incident.js';
export * from './enrich-with-deploy-diff.js';
export * from './dispatch-remediation.js';
export * from './notify-on-call.js';
export * from './record-decision.js';
export * from './orchestrator-workflow.js';
