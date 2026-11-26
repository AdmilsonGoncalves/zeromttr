import type { Incident } from '../domain/incident.js';

export interface IncidentRepository {
  findById(id: string): Promise<Incident | null>;
  findOpenByFingerprint(fingerprint: string): Promise<Incident | null>;
  findLatestByFingerprint?(fingerprint: string): Promise<Incident | null>;
  findAll(): Promise<Incident[]>;
  save(incident: Incident): Promise<void>;
}
