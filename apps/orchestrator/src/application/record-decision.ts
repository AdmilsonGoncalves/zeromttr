import {
  DecisionAction,
  DecisionHmac,
  DecisionSource,
  Incident,
  IncidentEventType,
  IncidentState,
  type IncidentDecisionAction,
  type IncidentDecisionSource
} from '../domain/index.js';
import type { IncidentRepository, ToolsPort, Clock, EventBroadcasterPort } from '../ports/index.js';

export class InvalidDecisionSignatureError extends Error {
  public constructor(message = 'Invalid or expired decision HMAC signature') {
    super(message);
    this.name = 'InvalidDecisionSignatureError';
  }
}

export class IncidentNotFoundError extends Error {
  public constructor(id: string) {
    super(`Incident '${id}' not found`);
    this.name = 'IncidentNotFoundError';
  }
}

export class IncidentAlreadyResolvedError extends Error {
  public constructor(id: string, currentState: IncidentState) {
    super(
      `Cannot record decision on incident '${id}' because its state is already '${currentState}'`
    );
    this.name = 'IncidentAlreadyResolvedError';
  }
}

export class RecordDecision {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly clock: Clock,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly hmacSecret: string
  ) {}

  public async execute(
    incidentId: string,
    action: IncidentDecisionAction,
    sig: string,
    exp: number
  ): Promise<Incident> {
    const nowSec = Math.floor(this.clock.now() / 1000);
    const isValid = DecisionHmac.verify(incidentId, action, sig, exp, nowSec, this.hmacSecret);

    if (!isValid) {
      throw new InvalidDecisionSignatureError();
    }

    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new IncidentNotFoundError(incidentId);
    }

    if (incident.state !== IncidentState.NOTIFIED) {
      throw new IncidentAlreadyResolvedError(incidentId, incident.state);
    }

    const targetState =
      action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED;

    const transition = incident.transition(
      targetState,
      `Decision executed via signed email link: ${action}`
    );

    incident.decision = action;
    const source: IncidentDecisionSource = DecisionSource.EMAIL_HMAC;
    incident.decisionSource = source;

    try {
      await this.tools.annotateGrafanaIncident({
        time: Date.now(),
        text: `[${targetState}] Incident ${incident.id} ${action === DecisionAction.APPROVE ? 'RESOLVED' : 'REJECTED'} via human approval`,
        tags: ['aiops-decision']
      });
    } catch {
      // Non-fatal annotation
    }

    await this.repository.save(incident);

    this.broadcaster.broadcast(IncidentEventType.DECISION, {
      incidentId: incident.id,
      action,
      source: DecisionSource.EMAIL_HMAC
    });

    this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
      incidentId: incident.id,
      from: transition.from,
      to: transition.to,
      at: transition.at,
      reason: transition.reason
    });

    return incident;
  }

  public async executeSimulated(
    incidentId: string,
    action: IncidentDecisionAction
  ): Promise<Incident> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new IncidentNotFoundError(incidentId);
    }

    if (incident.state !== IncidentState.NOTIFIED) {
      throw new IncidentAlreadyResolvedError(incidentId, incident.state);
    }

    const targetState =
      action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED;

    const transition = incident.transition(
      targetState,
      `Decision executed via interactive simulation: ${action}`
    );

    incident.decision = action;
    const simSource: IncidentDecisionSource = DecisionSource.DEMO_SIMULATION;
    incident.decisionSource = simSource;

    try {
      await this.tools.annotateGrafanaIncident({
        time: Date.now(),
        text: `[${targetState}] Incident ${incident.id} ${action} via interactive demo simulation`,
        tags: ['aiops-demo']
      });
    } catch {
      // Non-fatal annotation
    }

    await this.repository.save(incident);

    this.broadcaster.broadcast(IncidentEventType.DECISION, {
      incidentId: incident.id,
      action,
      source: DecisionSource.DEMO_SIMULATION
    });

    this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
      incidentId: incident.id,
      from: transition.from,
      to: transition.to,
      at: transition.at,
      reason: transition.reason
    });

    return incident;
  }
}
