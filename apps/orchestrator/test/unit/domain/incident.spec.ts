import { describe, it, expect } from 'vitest';
import { Incident, IncidentState } from '../../../src/domain/index.js';

describe('Incident Entity', () => {
  it('should initialize with defaults and record initial transition', () => {
    const inc = new Incident({
      id: 'inc-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service'
    });

    expect(inc.id).toBe('inc-001');
    expect(inc.state).toBe(IncidentState.RECEIVED);
    expect(inc.mode).toBe('live');
    expect(inc.transitions.length).toBe(1);
    expect(inc.transitions[0].to).toBe(IncidentState.RECEIVED);
  });

  it('should preserve provided transitions if supplied in constructor', () => {
    const customTransitions = [
      {
        from: null,
        to: IncidentState.RECEIVED,
        at: '2026-11-10T12:00:00Z'
      },
      {
        from: IncidentState.RECEIVED,
        to: IncidentState.INVESTIGATING,
        at: '2026-11-10T12:01:00Z'
      }
    ];

    const inc = new Incident({
      id: 'inc-002',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      state: IncidentState.INVESTIGATING,
      transitions: customTransitions
    });

    expect(inc.transitions.length).toBe(2);
    expect(inc.state).toBe(IncidentState.INVESTIGATING);
  });

  it('should return serializable summary and detail objects', () => {
    const inc = new Incident({
      id: 'inc-003',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'alert:service',
      mode: 'replay'
    });

    const summary = inc.toSummary();
    expect(summary).toEqual({
      id: 'inc-003',
      service: 'api-pagamentos-core',
      severity: 'critical',
      state: IncidentState.RECEIVED,
      mode: 'replay',
      startedAt: inc.startedAt
    });

    const detail = inc.toDetail();
    expect(detail.id).toBe('inc-003');
    expect(detail.fingerprint).toBe('alert:service');
    expect(detail.transitions).toBeInstanceOf(Array);
    expect(detail.mode).toBe('replay');
  });
});
