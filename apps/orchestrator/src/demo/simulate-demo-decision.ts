import { applyIncidentDecision } from '../application/index.js';
import {
  DecisionSource,
  GrafanaAnnotationTag,
  Incident,
  type IncidentDecisionAction
} from '../domain/index.js';
import type {
  EventBroadcasterPort,
  IncidentRepository,
  LoggerPort,
  ToolsPort
} from '../ports/index.js';

export class SimulateDemoDecision {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly logger?: LoggerPort
  ) {}

  public async execute(incidentId: string, action: IncidentDecisionAction): Promise<Incident> {
    return applyIncidentDecision(this.repository, this.tools, this.broadcaster, this.logger, {
      incidentId,
      action,
      source: DecisionSource.DEMO_SIMULATION,
      transitionReason: `Decision executed via interactive simulation: ${action}`,
      annotationText: (targetState) =>
        `[${targetState}] Incident ${incidentId} ${action} via interactive demo simulation`,
      annotationTags: [GrafanaAnnotationTag.DEMO]
    });
  }
}
