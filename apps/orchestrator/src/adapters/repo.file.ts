import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { diffInSeconds, isArray, isObject, safeJsonParse, toErrorMessage } from '@zeromttr/utils';
import {
  DecisionAction,
  DecisionSource,
  IncidentExecutionMode,
  NotificationStatus
} from '../domain/incident-enums.js';
import { Incident } from '../domain/incident.js';
import { IncidentState } from '../domain/incident-state.js';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import type { RcaReport } from '../domain/rca-report.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

const PersistedTransitionSchema = z.object({
  from: z.nativeEnum(IncidentState).nullable(),
  to: z.nativeEnum(IncidentState),
  at: z.string(),
  reason: z.string().optional()
});

const PersistedIncidentSchema = z
  .object({
    id: z.string().min(1),
    service: z.string().min(1),
    severity: z.string().min(1),
    fingerprint: z.string().min(1),
    alertName: z.string().optional(),
    state: z.nativeEnum(IncidentState).optional(),
    mode: z.enum([IncidentExecutionMode.LIVE, IncidentExecutionMode.REPLAY]).optional(),
    startedAt: z.string().optional(),
    transitions: z.array(PersistedTransitionSchema).optional(),
    rca: z.custom<RcaReport>((val) => isObject(val)).optional(),
    finops: z
      .object({
        rawBytesFetched: z.number(),
        compactedBytesSent: z.number(),
        payloadReductionPercent: z.number(),
        estimatedTokensSaved: z.number()
      })
      .optional(),
    docs: z
      .array(
        z.object({
          url: z.string(),
          title: z.string(),
          markdownExcerpt: z.string()
        })
      )
      .optional(),
    remediation: z
      .object({
        branchUrl: z.string(),
        pullRequestUrl: z.string().optional(),
        commitSha: z.string().optional(),
        suspectCommitSha: z.string().optional()
      })
      .passthrough()
      .optional(),
    notification: z
      .object({
        emailId: z.string(),
        htmlPreview: z.string().optional(),
        status: z.nativeEnum(NotificationStatus).optional()
      })
      .optional(),
    decision: z.enum([DecisionAction.APPROVE, DecisionAction.REJECT]).optional(),
    decisionSource: z.enum([DecisionSource.EMAIL_HMAC, DecisionSource.DEMO_SIMULATION]).optional()
  })
  .passthrough();

/**
 * In-memory incident repository with optional atomic JSON file persistence for replay and restart recovery.
 */
export class FileIncidentRepository implements IncidentRepository {
  private readonly store = new Map<string, Incident>();
  private readonly filePath?: string;

  public constructor(
    filePath?: string,
    private readonly logger?: LoggerPort
  ) {
    this.filePath = filePath || process.env.INCIDENT_STORE_PATH;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = safeJsonParse<unknown[]>(raw, []);
        if (isArray(parsed)) {
          for (const item of parsed) {
            const validated = PersistedIncidentSchema.safeParse(item);
            if (validated.success) {
              const inc = new Incident(validated.data);
              this.store.set(inc.id, inc);
            }
          }
        }
      } catch (err) {
        this.logger?.warn({
          event: OrchestratorLogEvent.INCIDENT_STORE_LOAD_FAILED,
          filePath: this.filePath,
          message: toErrorMessage(err, 'Failed to load persisted incidents')
        });
      }
    }
  }

  /**
   * Finds an incident by its unique ID.
   */
  public async findById(id: string): Promise<Incident | null> {
    const inc = this.store.get(id);
    return inc || null;
  }

  /**
   * Finds an active (non-terminal) incident matching the alert fingerprint.
   */
  public async findOpenByFingerprint(fingerprint: string): Promise<Incident | null> {
    for (const inc of this.store.values()) {
      if (
        inc.fingerprint === fingerprint &&
        inc.state !== IncidentState.RESOLVED &&
        inc.state !== IncidentState.REJECTED &&
        inc.state !== IncidentState.FAILED
      ) {
        return inc;
      }
    }
    return null;
  }

  /**
   * Finds the most recent incident (including terminal states) matching the alert fingerprint.
   */
  public async findLatestByFingerprint(fingerprint: string): Promise<Incident | null> {
    let latest: Incident | null = null;
    let latestRefTime = -Infinity;

    for (const inc of this.store.values()) {
      if (inc.fingerprint !== fingerprint) {
        continue;
      }
      const lastTransition = inc.transitions[inc.transitions.length - 1];
      const refIso = lastTransition ? lastTransition.at : inc.startedAt;
      const refMs = Date.parse(refIso);
      const score = Number.isFinite(refMs) ? refMs : 0;
      if (!latest || score >= latestRefTime) {
        latest = inc;
        latestRefTime = score;
      }
    }

    return latest;
  }

  /**
   * Returns all stored incidents sorted chronologically by start timestamp.
   */
  public async findAll(): Promise<Incident[]> {
    return Array.from(this.store.values()).sort((a, b) => diffInSeconds(a.startedAt, b.startedAt));
  }

  /**
   * Saves an incident in memory and atomically persists the store to disk when configured.
   */
  public async save(incident: Incident): Promise<void> {
    this.store.set(incident.id, incident);
    if (this.filePath) {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const data = Array.from(this.store.values()).map((inc) => inc.toDetail());
        const tmpPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.filePath);
      } catch (err) {
        this.logger?.warn({
          event: OrchestratorLogEvent.INCIDENT_STORE_SAVE_FAILED,
          incidentId: incident.id,
          filePath: this.filePath,
          message: toErrorMessage(err, 'Failed to persist incidents')
        });
      }
    }
  }

  /**
   * Clears all incidents from the in-memory store.
   */
  public clear(): void {
    this.store.clear();
  }
}
