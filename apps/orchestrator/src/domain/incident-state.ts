import { IncidentState, type IncidentTransition } from '@zeromttr/contracts';
import { isString, nowIso } from '@zeromttr/utils';

export { IncidentState };
export type { IncidentTransition };

export class InvalidTransitionError extends Error {
  public constructor(from: IncidentState, to: IncidentState, reason?: string) {
    const detail = reason ? ` (reason: ${reason})` : '';
    super(`Cannot transition incident from state '${from}' to '${to}'${detail}`);
    this.name = 'InvalidTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  [IncidentState.RECEIVED]: [IncidentState.INVESTIGATING, IncidentState.FAILED],
  [IncidentState.INVESTIGATING]: [IncidentState.ENRICHING, IncidentState.FAILED],
  [IncidentState.ENRICHING]: [IncidentState.REMEDIATING, IncidentState.FAILED],
  [IncidentState.REMEDIATING]: [IncidentState.AWAITING_PR, IncidentState.FAILED],
  [IncidentState.AWAITING_PR]: [IncidentState.NOTIFIED, IncidentState.FAILED],
  [IncidentState.NOTIFIED]: [IncidentState.RESOLVED, IncidentState.REJECTED, IncidentState.FAILED],
  [IncidentState.RESOLVED]: [],
  [IncidentState.REJECTED]: [],
  [IncidentState.FAILED]: []
};

const INCIDENT_STATE_VALUES: ReadonlySet<string> = new Set(Object.values(IncidentState));

/**
 * Type guard verifying whether an unknown value is a valid `IncidentState`.
 */
export function isIncidentState(value: unknown): value is IncidentState {
  return isString(value) && INCIDENT_STATE_VALUES.has(value);
}

/**
 * Checks whether transitioning from the current state to the target state is allowed.
 */
export function canTransition(from: IncidentState | string, to: IncidentState): boolean {
  if (!isIncidentState(from)) {
    return false;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Validates a state transition and returns a timestamped transition record, or throws `InvalidTransitionError`.
 */
export function transitionState(
  from: IncidentState,
  to: IncidentState,
  reason?: string,
  timestamp?: string
): IncidentTransition {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, reason);
  }

  return {
    from,
    to,
    at: timestamp ?? nowIso(),
    ...(reason ? { reason } : {})
  };
}

// Semantic version of the orchestrator incident domain state machine
export const ORCHESTRATOR_DOMAIN_VERSION = '1.0.0';

/**
 * Returns the initial incident state and orchestrator domain version.
 */
export function getIncidentInitialState(): { state: IncidentState; version: string } {
  return {
    state: IncidentState.RECEIVED,
    version: ORCHESTRATOR_DOMAIN_VERSION
  };
}
