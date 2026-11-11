import fs from 'node:fs';
import path from 'node:path';
import { safeJsonParse } from '@zeromttr/utils';
import { Incident, IncidentState, type IncidentProps } from '../domain/index.js';
import type { IncidentRepository } from '../ports/index.js';

export class FileIncidentRepository implements IncidentRepository {
  private readonly store = new Map<string, Incident>();
  private readonly filePath?: string;

  public constructor(filePath?: string) {
    this.filePath = filePath || process.env.INCIDENT_STORE_PATH;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = safeJsonParse<Array<Record<string, unknown>>>(raw, []);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const inc = new Incident(item as unknown as IncidentProps);
            this.store.set(inc.id, inc);
          }
        }
      } catch {
        // Fallback to empty store if corrupted
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
      } catch {
        // Non-fatal file write error
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }
}
