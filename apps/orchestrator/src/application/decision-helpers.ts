import { toErrorMessage } from '@zeromttr/utils';
import { DecisionAction, IncidentEventType } from '../domain/incident-enums.js';
import {
  Incident,
  type IncidentDecisionAction,
  type IncidentDecisionSource
} from '../domain/incident.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ToolsPort } from '../ports/tools.port.js';

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

export interface ApplyDecisionOptions {
  incidentId: string;
  action: IncidentDecisionAction;
  source: IncidentDecisionSource;
  transitionReason: string;
  annotationText: (targetState: IncidentState) => string;
  annotationTags: string[];
}

export async function applyIncidentDecision(
  repository: IncidentRepository,
  tools: ToolsPort,
  broadcaster: EventBroadcasterPort,
  logger: LoggerPort | undefined,
  options: ApplyDecisionOptions
): Promise<Incident> {
  const incident = await repository.findById(options.incidentId);
  if (!incident) {
    throw new IncidentNotFoundError(options.incidentId);
  }

  if (incident.state !== IncidentState.NOTIFIED) {
    throw new IncidentAlreadyResolvedError(options.incidentId, incident.state);
  }

  const targetState =
    options.action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED;

  const transition = incident.transition(targetState, options.transitionReason);

  incident.decision = options.action;
  incident.decisionSource = options.source;

  try {
    await tools.annotateGrafanaIncident({
      time: Date.now(),
      text: options.annotationText(targetState),
      tags: options.annotationTags
    });
  } catch (err) {
    // Non-fatal annotation
    logger?.warn({
      event: OrchestratorLogEvent.GRAFANA_DECISION_ANNOTATION_FAILED,
      incidentId: incident.id,
      message: toErrorMessage(err, 'Failed to annotate Grafana decision')
    });
  }

  await repository.save(incident);

  broadcaster.broadcast(IncidentEventType.DECISION, {
    incidentId: incident.id,
    action: options.action,
    source: options.source
  });

  broadcaster.broadcast(IncidentEventType.TRANSITION, {
    incidentId: incident.id,
    from: transition.from,
    to: transition.to,
    at: transition.at,
    reason: transition.reason
  });

  return incident;
}
