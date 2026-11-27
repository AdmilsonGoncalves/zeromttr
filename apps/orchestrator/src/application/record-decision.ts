import { toErrorMessage } from '@zeromttr/utils';
import { DecisionHmac } from '../domain/decision-hmac.js';
import { DecisionAction, DecisionSource, GrafanaAnnotationTag } from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import { Incident, type IncidentDecisionAction } from '../domain/incident.js';
import type { Clock } from '../ports/clock.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ToolsPort } from '../ports/tools.port.js';
import {
  applyIncidentDecision,
  IncidentAlreadyResolvedError,
  InvalidDecisionSignatureError
} from './decision-helpers.js';

export {
  InvalidDecisionSignatureError,
  IncidentNotFoundError,
  IncidentAlreadyResolvedError
} from './decision-helpers.js';

export type OnIncidentApprovedHook = (incident: Incident) => Promise<void> | void;
export type OnApprovedRetryHook = (incident: Incident) => Promise<boolean> | boolean;

/**
 * Use case verifying signed email HMAC tokens and finalizing incident approval or rejection.
 */
export class RecordDecision {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly clock: Clock,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly hmacSecret: string,
    private readonly logger?: LoggerPort,
    private readonly onIncidentApproved?: OnIncidentApprovedHook,
    private readonly onApprovedRetry?: OnApprovedRetryHook
  ) {}

  /**
   * Verifies the signed email decision HMAC token and records the human approval or rejection.
   */
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

    let incident: Incident;
    try {
      incident = await applyIncidentDecision(
        this.repository,
        this.tools,
        this.broadcaster,
        this.logger,
        {
          incidentId,
          action,
          source: DecisionSource.EMAIL_HMAC,
          transitionReason: `Decision executed via signed email link: ${action}`,
          annotationText: (targetState) =>
            `[${targetState}] Incident ${incidentId} ${targetState} via human approval`,
          annotationTags: [GrafanaAnnotationTag.DECISION]
        }
      );
    } catch (err) {
      if (
        err instanceof IncidentAlreadyResolvedError &&
        action === DecisionAction.APPROVE &&
        this.onApprovedRetry
      ) {
        const existing = await this.repository.findById(incidentId);
        if (
          existing &&
          existing.state === IncidentState.RESOLVED &&
          existing.decision === DecisionAction.APPROVE
        ) {
          const recovered = await this.onApprovedRetry(existing);
          if (recovered) {
            return existing;
          }
        }
      }
      throw err;
    }

    if (action === DecisionAction.APPROVE && this.onIncidentApproved) {
      try {
        await this.onIncidentApproved(incident);
      } catch (err) {
        this.logger?.warn({
          event: OrchestratorLogEvent.POST_APPROVAL_HOOK_FAILED,
          incidentId: incident.id,
          message: toErrorMessage(err)
        });
      }
    }

    return incident;
  }
}
