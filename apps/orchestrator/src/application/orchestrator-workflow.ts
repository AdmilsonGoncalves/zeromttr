import { toErrorMessage } from '@zeromttr/utils';
import {
  IncidentEventType,
  OrchestratorDefault,
  TargetHealthStatus,
  TransitionReason
} from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { CollectedEvidence } from '../ports/reasoning.port.js';
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

      const baseRef =
        (investigation.targetStatus?.status !== TargetHealthStatus.UNREACHABLE &&
          investigation.targetStatus?.previousHealthyVersion !== OrchestratorDefault.UNKNOWN &&
          investigation.targetStatus?.previousHealthyVersion) ||
        process.env.TARGET_BASE_REF ||
        OrchestratorDefault.DEFAULT_BASE_REF;
      const headRef =
        (investigation.targetStatus?.status !== TargetHealthStatus.UNREACHABLE &&
          investigation.targetStatus?.version !== OrchestratorDefault.UNKNOWN &&
          investigation.targetStatus?.version) ||
        process.env.TARGET_HEAD_REF ||
        OrchestratorDefault.DEFAULT_HEAD_REF;

      // Step 2: Git Deploy Diff Enrichment
      const diffOutput = await this.enrichWithDeployDiff.execute(incidentId, baseRef, headRef);

      // Step 3: Assemble Evidence
      const p95Latency = investigation.promqlOutput.summarizedSeries[0]?.p95 ?? 4600;
      const errorSpan = investigation.spans.find((s) => s.hasError && s.errorMessage);
      const traceErrorMessage =
        errorSpan?.errorMessage ||
        (investigation.hasTempoErrorSpan ? OrchestratorDefault.SPAN_ERROR_FALLBACK : undefined);

      const evidence: CollectedEvidence = {
        incidentId,
        service: incident.service,
        alertName: incident.alertName || OrchestratorDefault.DEFAULT_ALERT_NAME,
        promqlSummary: {
          metric: OrchestratorDefault.DEFAULT_METRIC,
          p95LatencyMs: p95Latency
        },
        traceAnalysis: {
          traceId: investigation.traceId || OrchestratorDefault.UNKNOWN_TRACE_ID,
          criticalOperation: investigation.criticalSpan,
          durationMs: investigation.traceAnalysis?.totalDurationMs ?? 4600,
          errorMessage: traceErrorMessage,
          servicesInvolved: investigation.servicesInvolved
        },
        logSample: investigation.logSample,
        gitDiff: {
          baseRef,
          headRef,
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
            toErrorMessage(err, TransitionReason.PIPELINE_FAILED)
          );
          await this.repository.save(incident);
          this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
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
