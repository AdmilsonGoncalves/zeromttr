import { round } from '@zeromttr/utils';
import {
  IncidentEventType,
  OrchestratorDefault,
  TransitionReason
} from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import { resolveTargetRepoUrl } from '../domain/target-repo-url.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { ToolsPort, GitDeployDiffOutput } from '../ports/tools.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';

/**
 * Use case enriching an investigating incident with Git deploy diffs, docs references, and FinOps stats.
 */
export class EnrichWithDeployDiff {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly servicePath: string = process.env.TARGET_SERVICE_PATH || 'apps/target-app-demo'
  ) {}

  /**
   * Transitions the incident to `ENRICHING`, fetches Git deploy diff, and records FinOps savings.
   */
  public async execute(
    incidentId: string,
    baseRef = process.env.TARGET_BASE_REF || OrchestratorDefault.DEFAULT_BASE_REF,
    headRef = process.env.TARGET_HEAD_REF || OrchestratorDefault.DEFAULT_HEAD_REF
  ): Promise<GitDeployDiffOutput> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    if (incident.state === IncidentState.INVESTIGATING) {
      const transition = incident.transition(
        IncidentState.ENRICHING,
        TransitionReason.ENRICHING_GIT_DIFF
      );
      await this.repository.save(incident);

      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transition.from,
        to: transition.to,
        at: transition.at,
        reason: transition.reason
      });
    }

    const diffOutput = await this.tools.inspectGitDeployDiff({
      base_ref: baseRef,
      head_ref: headRef,
      service_path: this.servicePath
    });

    incident.finops = {
      rawBytesFetched: diffOutput.finops.rawBytesFetched,
      compactedBytesSent: diffOutput.finops.compactedBytesSentToLlm,
      payloadReductionPercent: round(diffOutput.finops.payloadReductionPercent, 2),
      estimatedTokensSaved: diffOutput.finops.estimatedTokensSaved
    };

    incident.docs = [
      {
        url: resolveTargetRepoUrl(),
        title: `${incident.service} Deploy & Architecture Reference`,
        markdownExcerpt: `Deploy diff inspected for ${incident.service} (${baseRef} -> ${headRef}) at ${this.servicePath}.`
      }
    ];

    await this.repository.save(incident);

    this.broadcaster.broadcast(IncidentEventType.FINOPS, {
      incidentId: incident.id,
      ...incident.finops
    });

    this.broadcaster.broadcast(IncidentEventType.DOCS, {
      incidentId: incident.id,
      sources: incident.docs
    });

    return diffOutput;
  }
}
