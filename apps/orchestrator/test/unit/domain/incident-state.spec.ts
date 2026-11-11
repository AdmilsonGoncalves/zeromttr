import { describe, it, expect } from 'vitest';
import {
  IncidentState,
  InvalidTransitionError,
  canTransition,
  transitionState
} from '../../../src/domain/index.js';

describe('IncidentState FSM', () => {
  it('should allow valid transitions according to the lifecycle', () => {
    expect(canTransition(IncidentState.RECEIVED, IncidentState.INVESTIGATING)).toBe(true);
    expect(canTransition(IncidentState.INVESTIGATING, IncidentState.ENRICHING)).toBe(true);
    expect(canTransition(IncidentState.ENRICHING, IncidentState.REMEDIATING)).toBe(true);
    expect(canTransition(IncidentState.REMEDIATING, IncidentState.AWAITING_PR)).toBe(true);
    expect(canTransition(IncidentState.AWAITING_PR, IncidentState.NOTIFIED)).toBe(true);
    expect(canTransition(IncidentState.NOTIFIED, IncidentState.RESOLVED)).toBe(true);
    expect(canTransition(IncidentState.NOTIFIED, IncidentState.REJECTED)).toBe(true);
  });

  it('should allow transitions to FAILED from any non-terminal state', () => {
    const nonTerminalStates = [
      IncidentState.RECEIVED,
      IncidentState.INVESTIGATING,
      IncidentState.ENRICHING,
      IncidentState.REMEDIATING,
      IncidentState.AWAITING_PR,
      IncidentState.NOTIFIED
    ];

    for (const state of nonTerminalStates) {
      expect(canTransition(state, IncidentState.FAILED)).toBe(true);
    }
  });

  it('should disallow any transition from terminal states (RESOLVED, REJECTED, FAILED)', () => {
    const terminalStates = [IncidentState.RESOLVED, IncidentState.REJECTED, IncidentState.FAILED];
    const allStates = Object.values(IncidentState);

    for (const terminal of terminalStates) {
      for (const target of allStates) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('should disallow invalid non-sequential transitions', () => {
    expect(canTransition(IncidentState.RECEIVED, IncidentState.RESOLVED)).toBe(false);
    expect(canTransition(IncidentState.RECEIVED, IncidentState.REMEDIATING)).toBe(false);
    expect(canTransition(IncidentState.INVESTIGATING, IncidentState.AWAITING_PR)).toBe(false);
    expect(canTransition(IncidentState.AWAITING_PR, IncidentState.RESOLVED)).toBe(false);
  });

  it('should throw InvalidTransitionError when performing an invalid transition', () => {
    expect(() => {
      transitionState(IncidentState.RECEIVED, IncidentState.RESOLVED, 'Invalid jump');
    }).toThrow(InvalidTransitionError);

    expect(() => {
      transitionState(IncidentState.RESOLVED, IncidentState.INVESTIGATING, 'Re-opening');
    }).toThrow(InvalidTransitionError);
  });

  it('should return a transition record with timestamp and reason on valid transition', () => {
    const record = transitionState(
      IncidentState.RECEIVED,
      IncidentState.INVESTIGATING,
      'Grafana alert verified',
      '2026-11-10T12:00:00.000Z'
    );

    expect(record).toEqual({
      from: IncidentState.RECEIVED,
      to: IncidentState.INVESTIGATING,
      at: '2026-11-10T12:00:00.000Z',
      reason: 'Grafana alert verified'
    });
  });
});
