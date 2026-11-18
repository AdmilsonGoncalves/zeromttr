import { round } from '@zeromttr/utils';
import {
  IncidentEventType,
  IncidentState,
  OrchestratorDefault,
  TransitionReason
} from '../domain/index.js';
import type {
  IncidentRepository,
  ToolsPort,
  EventBroadcasterPort,
  GitDeployDiffOutput
} from '../ports/index.js';

export class EnrichWithDeployDiff {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly tools: ToolsPort,
    private readonly broadcaster: EventBroadcasterPort,
    private readonly servicePath: string = process.env.TARGET_SERVICE_PATH || 'apps/target-app-demo'
  ) {}

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
        url: process.env.TARGET_REPO_URL || '',
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
