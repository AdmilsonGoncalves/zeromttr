import { describe, it, expect, vi } from 'vitest';
import { HandleAlert } from '../../../src/application/handle-alert.js';
import { IncidentState } from '../../../src/domain/incident-state.js';
import { Incident } from '../../../src/domain/incident.js';
import type { IncidentRepository } from '../../../src/ports/incident-repository.port.js';
import type { EventBroadcasterPort } from '../../../src/ports/event-broadcaster.port.js';

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
    expect(result.incident?.service).toBe('api-pagamentos-core');
    expect(result.incident?.severity).toBe('critical');
    expect(result.incident?.state).toBe(IncidentState.RECEIVED);
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
    expect(second.incident?.id).toBe(first.incident?.id);
  });

  it('should ignore resolved Grafana notifications without creating an incident', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    const resolvedRes = await useCase.execute({
      status: 'resolved',
      alerts: [
        {
          status: 'resolved',
          labels: {
            alertname: 'PaymentServicePoolExhaustion',
            service: 'api-pagamentos-core',
            severity: 'critical'
          }
        }
      ]
    });

    expect(resolvedRes.ignored).toBe(true);
    expect(resolvedRes.incident).toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('should serialize concurrent firing alerts with the same fingerprint', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    const [first, second] = await Promise.all([
      useCase.execute(validPayload),
      useCase.execute(validPayload)
    ]);

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.incident?.id).toBe(first.incident?.id);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('should reject invalid payloads lacking required fields', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    await expect(useCase.execute({ alerts: [] })).rejects.toThrow();
  });

  it('should mark expired NOTIFIED incident as FAILED and create new incident for same fingerprint', async () => {
    const repo = createMockRepo();
    const broadcaster = createMockBroadcaster();
    const useCase = new HandleAlert(repo, broadcaster);

    const oldTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const existingExpiredIncident = new Incident({
      id: 'inc-old-001',
      service: 'api-pagamentos-core',
      severity: 'critical',
      fingerprint: 'PaymentServicePoolExhaustion:api-pagamentos-core',
      state: IncidentState.NOTIFIED,
      startedAt: oldTimestamp,
      transitions: [
        {
          from: IncidentState.AWAITING_PR,
          to: IncidentState.NOTIFIED,
          at: oldTimestamp,
          reason: 'Notification dispatched'
        }
      ]
    });
    await repo.save(existingExpiredIncident);

    const result = await useCase.execute(validPayload);
    expect(result.isDuplicate).toBe(false);
    expect(result.incident?.id).not.toBe('inc-old-001');
    expect(result.incident?.state).toBe(IncidentState.RECEIVED);
    expect(existingExpiredIncident.state).toBe(IncidentState.FAILED);
  });
});
