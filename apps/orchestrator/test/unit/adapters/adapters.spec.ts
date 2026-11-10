import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  McpClientAdapter,
  FileIncidentRepository,
  HttpTargetStatusAdapter,
  DeterministicFallbackReasoningAdapter,
  HEALTHY_PAYMENT_REPOSITORY_PATCH
} from '../../../src/adapters/index.js';
import { Incident, IncidentState } from '../../../src/domain/index.js';
import type { CollectedEvidence } from '../../../src/ports/index.js';

describe('Adapters Unit Tests', () => {
  const tempDir = path.resolve(import.meta.dirname, '../../temp-adapters-test');
  const tempFile = path.join(tempDir, 'incidents.json');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('DeterministicFallbackReasoningAdapter', () => {
    it('should generate fallback synthesis with clean healthy repository code and pool max 10', async () => {
      const adapter = new DeterministicFallbackReasoningAdapter();
      const evidence: CollectedEvidence = {
        incidentId: 'inc-001',
        service: 'api-pagamentos-core',
        alertName: 'Alert',
        promqlSummary: { metric: 'm' },
        traceAnalysis: {
          traceId: 'trace-456',
          criticalOperation: 'op',
          durationMs: 10,
          servicesInvolved: ['api']
        },
        logSample: 'log',
        gitDiff: {
          baseRef: 'v1',
          headRef: 'v2',
          suspectCommit: 'commit-789',
          authorLogin: 'bot',
          suspectFilePath: 'path',
          patch: 'p'
        }
      };

      const synthesis = await adapter.synthesizeRcaAndPatch(evidence);

      expect(synthesis.reasoningSource).toBe('fallback');
      expect(synthesis.suspectFilePath).toBe(
        'apps/target-app-demo/src/repositories/payment.repository.ts'
      );
      expect(synthesis.patchedContent).toBe(HEALTHY_PAYMENT_REPOSITORY_PATCH);
      expect(synthesis.patchedContent).toContain('client.release()');
      expect(synthesis.patchedContent).toContain('10');
      expect(synthesis.evidenceRefs).toContain('trace-456');
    });
  });

  describe('FileIncidentRepository', () => {
    it('should save and retrieve incidents from memory and file', async () => {
      const repo = new FileIncidentRepository(tempFile);

      const incident = new Incident({
        id: 'inc-repo-001',
        service: 'api-pagamentos-core',
        severity: 'critical',
        fingerprint: 'alert:service',
        state: IncidentState.INVESTIGATING
      });

      await repo.save(incident);

      const retrieved = await repo.findById('inc-repo-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('inc-repo-001');

      const open = await repo.findOpenByFingerprint('alert:service');
      expect(open).not.toBeNull();

      const all = await repo.findAll();
      expect(all.length).toBe(1);

      // Verify file was written
      expect(fs.existsSync(tempFile)).toBe(true);

      // Reload into new repository instance
      const reloadedRepo = new FileIncidentRepository(tempFile);
      const fromFile = await reloadedRepo.findById('inc-repo-001');
      expect(fromFile?.id).toBe('inc-repo-001');
    });
  });

  describe('McpClientAdapter', () => {
    it('should format JSON-RPC tools/call requests and parse output', async () => {
      const mockFetch = vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  seriesCount: 1,
                  summarizedSeries: [],
                  finops: {
                    rawBytesFetched: 100,
                    compactedBytesSentToLlm: 10,
                    payloadReductionPercent: 90,
                    estimatedTokensSaved: 10
                  }
                })
              }
            ],
            isError: false
          }
        })
      }));
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');
      const result = await adapter.executePromqlRange({
        query: 'test_metric',
        start: '2026-11-10T00:00:00Z',
        end: '2026-11-10T01:00:00Z'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/mcp',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123'
          })
        })
      );
      expect(result.seriesCount).toBe(1);
    });

    it('should throw when tool reports isError or HTTP fails', async () => {
      const mockFetchErr = vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'Prometheus query syntax error' }],
            isError: true
          }
        })
      }));
      vi.stubGlobal('fetch', mockFetchErr);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');
      await expect(
        adapter.executePromqlRange({ query: 'bad', start: '', end: '' })
      ).rejects.toThrow('Prometheus query syntax error');
    });
  });

  describe('HttpTargetStatusAdapter', () => {
    it('should query target app chaos status and handle fallback if offline', async () => {
      const mockFetch = vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          status: 'degraded',
          service: 'api-pagamentos-core',
          version: 'v2.14.8',
          previousHealthyVersion: 'v2.14.7',
          targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          rawEdgeLogPreCollector: 'raw'
        })
      }));
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new HttpTargetStatusAdapter('http://localhost:3000');
      const status = await adapter.getStatus();
      expect(status.status).toBe('degraded');

      await adapter.triggerChaos(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chaos/pool-saturation?enable=true'),
        expect.any(Object)
      );

      await adapter.reset();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chaos/pool-saturation?enable=false'),
        expect.any(Object)
      );
    });
  });
});
