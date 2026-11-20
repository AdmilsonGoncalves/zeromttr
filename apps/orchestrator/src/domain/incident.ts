import { isNonEmptyArray, nowIso } from '@zeromttr/utils';
import { IncidentState, transitionState, type IncidentTransition } from './incident-state.js';
import {
  IncidentExecutionMode,
  type DecisionAction,
  type DecisionSource,
  type NotificationStatus
} from './incident-enums.js';
import type { RcaReport, ReasoningSource } from './rca-report.js';

export type IncidentDecisionAction = DecisionAction | `${DecisionAction}`;
export type IncidentDecisionSource = DecisionSource | `${DecisionSource}`;
export type IncidentMode = IncidentExecutionMode | `${IncidentExecutionMode}`;
export type { ReasoningSource };

export interface IncidentFinops {
  rawBytesFetched: number;
  compactedBytesSent: number;
  payloadReductionPercent: number;
  estimatedTokensSaved: number;
}

export interface IncidentDocRef {
  url: string;
  title: string;
  markdownExcerpt: string;
}

export interface IncidentRemediation {
  branchUrl: string;
  pullRequestUrl?: string;
  commitSha?: string;
  suspectCommitSha?: string;
}

export interface IncidentNotification {
  emailId: string;
  htmlPreview?: string;
  status?: NotificationStatus | `${NotificationStatus}`;
}

export interface IncidentProps {
  id: string;
  service: string;
  severity: string;
  fingerprint: string;
  alertName?: string;
  state?: IncidentState;
  mode?: IncidentMode;
  startedAt?: string;
  transitions?: IncidentTransition[];
  rca?: RcaReport;
  finops?: IncidentFinops;
  docs?: IncidentDocRef[];
  remediation?: IncidentRemediation;
  notification?: IncidentNotification;
  decision?: IncidentDecisionAction;
  decisionSource?: IncidentDecisionSource;
}

/**
 * Core incident aggregate enforcing valid FSM state transitions and encapsulating RCA and remediation state.
 */
export class Incident {
  public readonly id: string;
  public readonly service: string;
  public readonly severity: string;
  public readonly fingerprint: string;
  public readonly alertName?: string;
  public readonly mode: IncidentMode;
  public readonly startedAt: string;

  private _state: IncidentState;
  private _transitions: IncidentTransition[];

  public rca?: RcaReport;
  public finops?: IncidentFinops;
  public docs?: IncidentDocRef[];
  public remediation?: IncidentRemediation;
  public notification?: IncidentNotification;
  public decision?: IncidentDecisionAction;
  public decisionSource?: IncidentDecisionSource;

  public constructor(props: IncidentProps) {
    this.id = props.id;
    this.service = props.service;
    this.severity = props.severity;
    this.fingerprint = props.fingerprint;
    this.alertName = props.alertName;
    this.mode = props.mode ?? IncidentExecutionMode.LIVE;
    this.startedAt = props.startedAt ?? nowIso();
    this._state = props.state ?? IncidentState.RECEIVED;

    if (isNonEmptyArray(props.transitions)) {
      this._transitions = [...props.transitions];
    } else {
      this._transitions = [
        {
          from: null,
          to: this._state,
          at: this.startedAt,
          reason: 'Incident initiated'
        }
      ];
    }

    this.rca = props.rca;
    this.finops = props.finops;
    this.docs = props.docs;
    this.remediation = props.remediation;
    this.notification = props.notification;
    this.decision = props.decision;
    this.decisionSource = props.decisionSource;
  }

  /**
   * Returns the current lifecycle state of the incident.
   */
  public get state(): IncidentState {
    return this._state;
  }

  /**
   * Returns the ordered history of state transitions for this incident.
   */
  public get transitions(): readonly IncidentTransition[] {
    return this._transitions;
  }

  /**
   * Advances the incident to a valid next state and appends the transition record.
   */
  public transition(to: IncidentState, reason?: string, at?: string): IncidentTransition {
    const record = transitionState(this._state, to, reason, at);
    this._state = to;
    this._transitions.push(record);
    return record;
  }

  /**
   * Serializes the incident into a compact summary DTO for list endpoints.
   */
  public toSummary(): {
    id: string;
    service: string;
    severity: string;
    state: IncidentState;
    mode: IncidentMode;
    startedAt: string;
  } {
    return {
      id: this.id,
      service: this.service,
      severity: this.severity,
      state: this._state,
      mode: this.mode,
      startedAt: this.startedAt
    };
  }

  /**
   * Serializes the complete incident record including RCA, FinOps, remediation, and decision metadata.
   */
  public toDetail(): {
    id: string;
    service: string;
    severity: string;
    fingerprint: string;
    alertName?: string;
    state: IncidentState;
    mode: IncidentMode;
    startedAt: string;
    transitions: IncidentTransition[];
    rca?: RcaReport;
    finops?: IncidentFinops;
    docs?: IncidentDocRef[];
    remediation?: IncidentRemediation;
    notification?: IncidentNotification;
    decision?: IncidentDecisionAction;
    decisionSource?: IncidentDecisionSource;
  } {
    return {
      id: this.id,
      service: this.service,
      severity: this.severity,
      fingerprint: this.fingerprint,
      alertName: this.alertName,
      state: this._state,
      mode: this.mode,
      startedAt: this.startedAt,
      transitions: [...this._transitions],
      rca: this.rca,
      finops: this.finops,
      docs: this.docs,
      remediation: this.remediation,
      notification: this.notification,
      decision: this.decision,
      decisionSource: this.decisionSource
    };
  }
}
