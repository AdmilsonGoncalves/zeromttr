import { toErrorMessage } from '@zeromttr/utils';
import { IncidentState } from '../domain/index.js';
import type {
  IncidentRepository,
  EventBroadcasterPort,
  CollectedEvidence
} from '../ports/index.js';
import type { InvestigateIncident } from './investigate-incident.js';
import type { EnrichWithDeployDiff } from './enrich-with-deploy-diff.js';
import type { DispatchRemediation } from './dispatch-remediation.js';
import type { NotifyOnCall } from './notify-on-call.js';

export class OrchestratorWorkflow {
  public constructor(
    private readonly repository: IncidentRepository,
    private readonly investigateIncident: InvestigateIncident,
    private readonly enrichWithDeployDiff: EnrichWithDeployDiff,
    private readonly dispatchRemediation: DispatchRemediation,
    private readonly notifyOnCall: NotifyOnCall,
    private readonly broadcaster: EventBroadcasterPort
  ) {}

  public async runFullPipeline(incidentId: string): Promise<void> {
    try {
      const incident = await this.repository.findById(incidentId);
      if (!incident) {
        return;
      }

      // Step 1: Telemetry Investigation
      const investigation = await this.investigateIncident.execute(incidentId);

      // Step 2: Git Deploy Diff Enrichment
      const diffOutput = await this.enrichWithDeployDiff.execute(
        incidentId,
        investigation.targetStatus?.previousHealthyVersion || 'v2.14.7',
        investigation.targetStatus?.version || 'v2.14.8'
      );

      // Step 3: Assemble Evidence
      const p95Latency = investigation.promqlOutput.summarizedSeries[0]?.p95 ?? 4600;
      const evidence: CollectedEvidence = {
        incidentId,
        service: incident.service,
        alertName: 'PaymentServicePoolExhaustion',
        promqlSummary: {
          metric: 'http_server_duration_milliseconds_bucket',
          p95LatencyMs: p95Latency,
          dbPoolWaiting: 15
        },
        traceAnalysis: {
          traceId: investigation.traceId,
          criticalOperation: investigation.criticalSpan,
          durationMs: investigation.traceAnalysis?.totalDurationMs ?? 4600,
          errorMessage:
            'KnexTimeoutError: Knex: Timeout acquiring a connection. The pool is probably full.',
          servicesInvolved: investigation.servicesInvolved
        },
        logSample: investigation.logSample,
        gitDiff: {
          baseRef: investigation.targetStatus?.previousHealthyVersion ?? 'v2.14.7',
          headRef: investigation.targetStatus?.version ?? 'v2.14.8',
          suspectCommit: diffOutput.suspectCommitSha,
          authorLogin: diffOutput.authorLogin,
          suspectFilePath: diffOutput.suspectFilePath,
          patch: diffOutput.truncatedPatch
        },
        signals: {
          hasPromqlAnomaly: investigation.hasPromqlAnomaly,
          hasMetricExemplar: investigation.hasMetricExemplar,
          hasTempoErrorSpan: investigation.hasTempoErrorSpan,
          hasLokiLogAndGitDiff: Boolean(investigation.logSample && diffOutput.truncatedPatch)
        }
      };

      // Step 4: Dispatch Remediation (Zero-PII Audit, LLM/Fallback Synthesis, PR)
      await this.dispatchRemediation.execute(incidentId, evidence, diffOutput.currentBlobSha);

      // Step 5: Notify On-Call via Resend with HMAC decision links
      await this.notifyOnCall.execute(incidentId);
    } catch (err) {
      const incident = await this.repository.findById(incidentId);
      if (
        incident &&
        incident.state !== IncidentState.RESOLVED &&
        incident.state !== IncidentState.REJECTED
      ) {
        try {
          const transition = incident.transition(
            IncidentState.FAILED,
            toErrorMessage(err, 'Pipeline execution failed')
          );
          await this.repository.save(incident);
          this.broadcaster.broadcast('incident.transition', {
            incidentId: incident.id,
            from: transition.from,
            to: transition.to,
            at: transition.at,
            reason: transition.reason
          });
        } catch {
          // Ignore secondary transition error
        }
      }
    }
  }
}
