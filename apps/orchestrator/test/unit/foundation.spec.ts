import { describe, it, expect } from 'vitest';
import { getIncidentInitialState } from '../../src/domain/index.js';
import { createInitialIncident } from '../../src/application/index.js';

describe('orchestrator foundation', () => {
  it('should return initial state from domain', () => {
    const initial = getIncidentInitialState();
    expect(initial.state).toBe('RECEIVED');
    expect(initial.version).toBe('1.0.0');
  });

  it('should create initial incident in application layer', () => {
    const incident = createInitialIncident();
    expect(incident.id).toBe('inc-init-001');
    expect(incident.state).toBe('RECEIVED');
  });
});
