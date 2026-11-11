import { round } from '@zeromttr/utils';
import { IncidentState } from '../domain/index.js';
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
    private readonly broadcaster: EventBroadcasterPort
  ) {}

  public async execute(
    incidentId: string,
    baseRef = 'v2.14.7',
    headRef = 'v2.14.8'
  ): Promise<GitDeployDiffOutput> {
    const incident = await this.repository.findById(incidentId);
    if (!incident) {
      throw new Error(`Incident '${incidentId}' not found`);
    }

    if (incident.state === IncidentState.INVESTIGATING) {
      const transition = incident.transition(
        IncidentState.ENRICHING,
        'Inspecting git deploy diff on GitHub'
      );
      await this.repository.save(incident);

      this.broadcaster.broadcast('incident.transition', {
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
      service_path: 'apps/target-app-demo'
    });

    incident.finops = {
      rawBytesFetched: diffOutput.finops.rawBytesFetched,
      compactedBytesSent: diffOutput.finops.compactedBytesSentToLlm,
      payloadReductionPercent: round(diffOutput.finops.payloadReductionPercent, 2),
      estimatedTokensSaved: diffOutput.finops.estimatedTokensSaved
    };

    incident.docs = [
      {
        url: 'https://github.com/AdmilsonGoncalves/zeromttr',
        title: 'Payment Service Pool Architecture',
        markdownExcerpt:
          'Payment service acquires PostgreSQL client from pool and must release in finally block.'
      }
    ];

    await this.repository.save(incident);

    this.broadcaster.broadcast('incident.finops', {
      incidentId: incident.id,
      ...incident.finops
    });

    this.broadcaster.broadcast('incident.docs', {
      incidentId: incident.id,
      sources: incident.docs
    });

    return diffOutput;
  }
}
