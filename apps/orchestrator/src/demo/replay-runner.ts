import fs from 'node:fs';
import path from 'node:path';
import { ReplaySnapshotSchema, type ReplaySnapshot } from '@zeromttr/contracts';
import { nowIso, parseNumber, round, safeJsonParse, toErrorMessage } from '@zeromttr/utils';
import { Incident, type IncidentFinops } from '../domain/incident.js';
import {
  IncidentEventType,
  IncidentExecutionMode,
  NotificationStatus,
  OrchestratorDefault
} from '../domain/incident-enums.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import type { RcaReport } from '../domain/rca-report.js';
import type { EventBroadcasterPort } from '../ports/event-broadcaster.port.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export interface ReplayRunnerOptions {
  snapshotPath?: string;
  speedFactor?: number;
}

const REPLAY_ORDERED_STATES: readonly IncidentState[] = [
  IncidentState.RECEIVED,
  IncidentState.INVESTIGATING,
  IncidentState.ENRICHING,
  IncidentState.REMEDIATING,
  IncidentState.AWAITING_PR,
  IncidentState.NOTIFIED
];

/**
 * Replays a recorded incident snapshot over SSE with accelerated timeline delays.
 */
export class ReplayRunner {
  private readonly snapshotPath: string;
  private readonly speedFactor: number;
  private activeRunId = 0;
  private activeDelayTimer: NodeJS.Timeout | undefined;
  private activeDelayResolve: (() => void) | undefined;

  public constructor(
    private readonly repository: IncidentRepository,
    private readonly broadcaster: EventBroadcasterPort,
    options: ReplayRunnerOptions = {},
    private readonly logger?: LoggerPort
  ) {
    this.snapshotPath =
      options.snapshotPath || process.env.REPLAY_SNAPSHOT_PATH || this.resolveDefaultSnapshotPath();
    this.speedFactor = options.speedFactor ?? parseNumber(process.env.REPLAY_SPEED_FACTOR, 1);
  }

  private resolveDefaultSnapshotPath(): string {
    const cwdCandidate = path.resolve(process.cwd(), 'data/last-recorded-incident.json');
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }
    return path.resolve(process.cwd(), '../../data/last-recorded-incident.json');
  }

  /**
   * Reads and validates the recorded replay snapshot JSON file from disk.
   */
  public loadSnapshot(): ReplaySnapshot {
    if (!fs.existsSync(this.snapshotPath)) {
      throw new Error(`Replay snapshot not found at '${this.snapshotPath}'`);
    }
    const rawText = fs.readFileSync(this.snapshotPath, 'utf-8');
    const parsedJson = safeJsonParse<unknown>(rawText);
    const validated = ReplaySnapshotSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new Error(`Invalid replay snapshot schema at '${this.snapshotPath}'`);
    }
    return validated.data;
  }

  /**
   * Cancels any active replay timeline playback and clears pending delay timers.
   */
  public stop(): void {
    this.activeRunId++;
    if (this.activeDelayTimer) {
      clearTimeout(this.activeDelayTimer);
      this.activeDelayTimer = undefined;
    }
    if (this.activeDelayResolve) {
      const resolve = this.activeDelayResolve;
      this.activeDelayResolve = undefined;
      resolve();
    }
  }

  /**
   * Starts a deterministic replay incident from the recorded snapshot and streams SSE events.
   */
  public async trigger(): Promise<string> {
    const snapshot = this.loadSnapshot();
    this.stop();
    const runId = this.activeRunId;
    const replayIncidentId = `${snapshot.incidentId}-${Date.now()}-${runId}`;
    const startedAt = nowIso();

    const incident = new Incident({
      id: replayIncidentId,
      service: snapshot.service,
      severity: snapshot.severity,
      fingerprint: `replay:${replayIncidentId}`,
      state: IncidentState.RECEIVED,
      mode: IncidentExecutionMode.REPLAY,
      startedAt
    });
    await this.repository.save(incident);

    if (runId !== this.activeRunId) {
      return replayIncidentId;
    }

    void this.playTimeline(runId, incident, snapshot).catch((err: unknown) => {
      this.logger?.error({
        event: OrchestratorLogEvent.REPLAY_PLAYBACK_FAILED,
        incidentId: replayIncidentId,
        error: toErrorMessage(err, 'Replay playback failed')
      });
    });

    return replayIncidentId;
  }

  private async delay(runId: number, ms: number): Promise<void> {
    if (runId !== this.activeRunId) {
      return;
    }
    const scaledMs = Math.max(0, round(ms * this.speedFactor));
    if (scaledMs === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      if (runId !== this.activeRunId) {
        resolve();
        return;
      }
      this.activeDelayResolve = resolve;
      this.activeDelayTimer = setTimeout(() => {
        if (runId === this.activeRunId) {
          this.activeDelayTimer = undefined;
          this.activeDelayResolve = undefined;
        }
        resolve();
      }, scaledMs);
    });
  }

  private buildFinops(snapshot: ReplaySnapshot): IncidentFinops {
    return {
      rawBytesFetched: snapshot.finops.rawBytesFetched,
      compactedBytesSent: snapshot.finops.compactedBytesSentToLlm,
      payloadReductionPercent: snapshot.finops.payloadReductionPercent,
      estimatedTokensSaved: snapshot.finops.estimatedTokensSaved
    };
  }

  private buildRcaReport(snapshot: ReplaySnapshot): RcaReport {
    return {
      summary: snapshot.rca.summary,
      rootCause: snapshot.rca.rootCause,
      reasoningSource: snapshot.rca.reasoningSource,
      evidenceCoveragePercent: snapshot.evidenceCoverage.score,
      signalsCollected: snapshot.evidenceCoverage.signalsCollected,
      signalsTotal: snapshot.evidenceCoverage.signalsTotal,
      blastRadius: snapshot.blastRadius.servicesInvolved,
      diagnosisSeconds: snapshot.rca.diagnosisSeconds ?? 6,
      traceId: snapshot.rca.traceId ?? OrchestratorDefault.UNKNOWN_TRACE_ID,
      criticalSpan: snapshot.rca.criticalSpan ?? OrchestratorDefault.CRITICAL_ERROR_SPAN,
      spans: snapshot.rca.spans ?? [],
      rawEdgeLogPreCollector: snapshot.rca.rawEdgeLogPreCollector,
      logSample: snapshot.rca.logSample ?? '[REDACTED_PII]',
      piiGuardAudit: snapshot.piiGuardAudit,
      deployVersion: snapshot.rca.deployVersion,
      mitigations: snapshot.rca.mitigations ?? [snapshot.rca.rootCause],
      grafanaAnnotationId: snapshot.rca.grafanaAnnotationId
    };
  }

  private emitFinops(incident: Incident, snapshot: ReplaySnapshot): void {
    const finops = this.buildFinops(snapshot);
    incident.finops = finops;
    this.broadcaster.broadcast(IncidentEventType.FINOPS, {
      incidentId: incident.id,
      ...finops
    });
  }

  private emitDocs(incident: Incident, snapshot: ReplaySnapshot): void {
    if (!snapshot.docs || snapshot.docs.length === 0) {
      return;
    }
    incident.docs = snapshot.docs;
    this.broadcaster.broadcast(IncidentEventType.DOCS, {
      incidentId: incident.id,
      sources: snapshot.docs
    });
  }

  private emitNotified(incident: Incident, snapshot: ReplaySnapshot): void {
    const notification = snapshot.notification ?? {
      emailId: `replay-${incident.id}`,
      status: NotificationStatus.DISPATCHED
    };
    incident.notification = notification;
    this.broadcaster.broadcast(IncidentEventType.NOTIFIED, {
      incidentId: incident.id,
      emailId: notification.emailId,
      htmlPreview: notification.htmlPreview,
      status: notification.status ?? NotificationStatus.DISPATCHED
    });
  }

  private advanceToState(incident: Incident, targetState: IncidentState): void {
    const currentIdx = REPLAY_ORDERED_STATES.indexOf(incident.state);
    const targetIdx = REPLAY_ORDERED_STATES.indexOf(targetState);
    if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) {
      return;
    }

    for (let idx = currentIdx + 1; idx <= targetIdx; idx++) {
      const nextState = REPLAY_ORDERED_STATES[idx];
      const transition = incident.transition(nextState, `Replay step: ${nextState}`);
      this.broadcaster.broadcast(IncidentEventType.TRANSITION, {
        incidentId: incident.id,
        from: transition.from,
        to: transition.to,
        at: transition.at,
        reason: transition.reason
      });
    }
  }

  private async playTimeline(
    runId: number,
    incident: Incident,
    snapshot: ReplaySnapshot
  ): Promise<void> {
    if (runId !== this.activeRunId) {
      return;
    }

    let finopsEmitted = false;
    let docsEmitted = false;
    let notifiedEmitted = false;

    for (const step of snapshot.eventsTimeline) {
      if (runId !== this.activeRunId) {
        return;
      }
      await this.delay(runId, step.delayMs);
      if (runId !== this.activeRunId) {
        return;
      }

      if (step.event === IncidentEventType.CREATED) {
        this.broadcaster.broadcast(IncidentEventType.CREATED, {
          incidentId: incident.id,
          service: incident.service,
          severity: incident.severity,
          mode: IncidentExecutionMode.REPLAY,
          at: incident.startedAt
        });
      } else if (step.event === IncidentEventType.TRANSITION && step.state) {
        if (step.state === IncidentState.NOTIFIED && !notifiedEmitted) {
          this.emitNotified(incident, snapshot);
          notifiedEmitted = true;
        }
        this.advanceToState(incident, step.state);
      } else if (step.event === IncidentEventType.FINOPS) {
        this.emitFinops(incident, snapshot);
        finopsEmitted = true;
      } else if (step.event === IncidentEventType.DOCS) {
        this.emitDocs(incident, snapshot);
        docsEmitted = true;
      } else if (step.event === IncidentEventType.RCA) {
        if (!finopsEmitted) {
          this.emitFinops(incident, snapshot);
          finopsEmitted = true;
        }
        if (!docsEmitted) {
          this.emitDocs(incident, snapshot);
          docsEmitted = true;
        }
        const rca = this.buildRcaReport(snapshot);
        incident.rca = rca;
        this.broadcaster.broadcast(IncidentEventType.RCA, {
          incidentId: incident.id,
          ...rca
        });
      } else if (step.event === IncidentEventType.REMEDIATION) {
        incident.remediation = { ...snapshot.remediation };
        this.broadcaster.broadcast(IncidentEventType.REMEDIATION, {
          incidentId: incident.id,
          ...snapshot.remediation
        });
      } else if (step.event === IncidentEventType.NOTIFIED) {
        this.emitNotified(incident, snapshot);
        notifiedEmitted = true;
      }

      await this.repository.save(incident);
    }

    if (runId !== this.activeRunId) {
      return;
    }

    if (!finopsEmitted) {
      this.emitFinops(incident, snapshot);
    }
    if (!notifiedEmitted) {
      this.emitNotified(incident, snapshot);
    }
    if (incident.state !== IncidentState.NOTIFIED) {
      this.advanceToState(incident, IncidentState.NOTIFIED);
    }
    await this.repository.save(incident);
  }
}
