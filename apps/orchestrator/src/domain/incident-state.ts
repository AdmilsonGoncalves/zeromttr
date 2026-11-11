import { nowIso } from '@zeromttr/utils';

export enum IncidentState {
  RECEIVED = 'RECEIVED',
  INVESTIGATING = 'INVESTIGATING',
  ENRICHING = 'ENRICHING',
  REMEDIATING = 'REMEDIATING',
  AWAITING_PR = 'AWAITING_PR',
  NOTIFIED = 'NOTIFIED',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED'
}

export interface IncidentTransition {
  from: IncidentState | null;
  to: IncidentState;
  at: string;
  reason?: string;
}

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

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.includes(to);
}

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
