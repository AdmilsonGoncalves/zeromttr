import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { safeJsonParse, toErrorMessage } from '@zeromttr/utils';
import { Incident, IncidentState, type IncidentProps } from '../domain/index.js';
import type { IncidentRepository } from '../ports/index.js';

const PersistedIncidentSchema = z
  .object({
    id: z.string().min(1),
    service: z.string().min(1),
    severity: z.string().min(1),
    fingerprint: z.string().min(1)
  })
  .passthrough();

export class FileIncidentRepository implements IncidentRepository {
  private readonly store = new Map<string, Incident>();
  private readonly filePath?: string;

  public constructor(filePath?: string) {
    this.filePath = filePath || process.env.INCIDENT_STORE_PATH;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = safeJsonParse<unknown[]>(raw, []);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const validated = PersistedIncidentSchema.safeParse(item);
            if (validated.success) {
              const inc = new Incident(validated.data as IncidentProps);
              this.store.set(inc.id, inc);
            }
          }
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'incident_store_load_failed',
            filePath: this.filePath,
            message: toErrorMessage(err, 'Failed to load persisted incidents')
          })
        );
      }
    }
  }

  public async findById(id: string): Promise<Incident | null> {
    const inc = this.store.get(id);
    return inc || null;
  }

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

  public async findAll(): Promise<Incident[]> {
    return Array.from(this.store.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

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
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'incident_store_save_failed',
            incidentId: incident.id,
            filePath: this.filePath,
            message: toErrorMessage(err, 'Failed to persist incidents')
          })
        );
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }
}
