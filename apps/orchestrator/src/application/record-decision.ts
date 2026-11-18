import {
  DecisionHmac,
  DecisionSource,
  GrafanaAnnotationTag,
  Incident,
  type IncidentDecisionAction
} from '../domain/index.js';
import type {
  Clock,
  EventBroadcasterPort,
  IncidentRepository,
  LoggerPort,
  ToolsPort
} from '../ports/index.js';
import { applyIncidentDecision, InvalidDecisionSignatureError } from './decision-helpers.js';

export {
  InvalidDecisionSignatureError,
  IncidentNotFoundError,
  IncidentAlreadyResolvedError
} from './decision-helpers.js';

export class RecordDecision {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly clock: Clock,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly hmacSecret: string,
    private readonly logger?: LoggerPort
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

    return applyIncidentDecision(this.repository, this.tools, this.broadcaster, this.logger, {
      incidentId,
      action,
      source: DecisionSource.EMAIL_HMAC,
      transitionReason: `Decision executed via signed email link: ${action}`,
      annotationText: (targetState) =>
        `[${targetState}] Incident ${incidentId} ${targetState} via human approval`,
      annotationTags: [GrafanaAnnotationTag.DECISION]
    });
  }
}
