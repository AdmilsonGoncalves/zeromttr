import { applyIncidentDecision } from '../application/decision-helpers.js';
import { DecisionSource, GrafanaAnnotationTag } from '../domain/incident-enums.js';
import { Incident, type IncidentDecisionAction } from '../domain/incident.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ToolsPort } from '../ports/tools.port.js';

export class SimulateDemoDecision {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly logger?: LoggerPort
  ) {}

  /**
   * Records a simulated on-call approve or reject decision for interactive dashboard demos.
   */
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
