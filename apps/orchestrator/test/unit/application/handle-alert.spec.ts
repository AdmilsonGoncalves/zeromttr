import { describe, it, expect, vi } from 'vitest';
import { HandleAlert } from '../../../src/application/index.js';
import { IncidentState, Incident } from '../../../src/domain/index.js';
import type { IncidentRepository, EventBroadcasterPort } from '../../../src/ports/index.js';

describe('HandleAlert Use Case', () => {
  const createMockRepo = (): IncidentRepository => {
    const store = new Map<string, Incident>();
    return {
      findById: vi.fn(async (id: string) => store.get(id) || null),
      findOpenByFingerprint: vi.fn(async (fp: string) => {
        for (const inc of store.values()) {
          if (
            inc.fingerprint === fp &&
            inc.state !== IncidentState.RESOLVED &&
            inc.state !== IncidentState.REJECTED
          ) {
            return inc;
          }
        }
        return null;
      }),
      findAll: vi.fn(async () => Array.from(store.values())),
      save: vi.fn(async (incident: Incident) => {
        store.set(incident.id, incident);
      })
    };
  };

  const createMockBroadcaster = (): EventBroadcasterPort => ({
    broadcast: vi.fn()
  });

  const validPayload = {
    alerts: [
      {
        status: 'firing',
        labels: {
          alertname: 'PaymentServicePoolExhaustion',
          service: 'api-pagamentos-core',
          severity: 'critical'
        },
        annotations: {
          summary: 'Pool exhausted'
        }
      }
    ]
  };

  it('should accept valid Grafana alert, create Incident in RECEIVED state, and emit events', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    const result = await useCase.execute(validPayload);

    expect(result.isDuplicate).toBe(false);
    expect(result.incident.service).toBe('api-pagamentos-core');
    expect(result.incident.severity).toBe('critical');
    expect(result.incident.state).toBe(IncidentState.RECEIVED);
    expect(repo.save).toHaveBeenCalled();
    expect(broadcaster.broadcast).toHaveBeenCalledWith('incident.created', expect.any(Object));
  });

  it('should deduplicate alert if open incident with same fingerprint already exists', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    const first = await useCase.execute(validPayload);
    expect(first.isDuplicate).toBe(false);

    const second = await useCase.execute(validPayload);
    expect(second.isDuplicate).toBe(true);
    expect(second.incident.id).toBe(first.incident.id);
  });

  it('should reject invalid payloads lacking required fields', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    await expect(useCase.execute({ alerts: [] } as any)).rejects.toThrow();
  });
});
