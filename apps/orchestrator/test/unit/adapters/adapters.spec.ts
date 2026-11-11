import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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
  const tempDir = path.join(os.tmpdir(), `zeromttr-adapters-test-${process.pid}`);
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

    it('should throw an informative error when tool output is empty', async () => {
      const mockFetchEmpty = vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: '   ' }],
            isError: false
          }
        })
      }));
      vi.stubGlobal('fetch', mockFetchEmpty);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');
      await expect(
        adapter.executePromqlRange({ query: 'metric', start: '', end: '' })
      ).rejects.toThrow("MCP tool 'execute_promql_range' returned empty or missing output text");
    });

    it('should throw an informative error when tool output is invalid JSON', async () => {
      const mockFetchInvalid = vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => '',
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'not valid json {{{' }],
            isError: false
          }
        })
      }));
      vi.stubGlobal('fetch', mockFetchInvalid);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');
      await expect(
        adapter.executePromqlRange({ query: 'metric', start: '', end: '' })
      ).rejects.toThrow(
        "MCP tool 'execute_promql_range' response could not be parsed as a valid JSON object"
      );
    });

    it('should properly map snake_case responses from executePromqlRange, queryLokiLogs and inspectGitDeployDiff', async () => {
      const mockFetchSnake = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const tool = body.params.name;
        let responseData = {};

        if (tool === 'execute_promql_range') {
          responseData = {
            query: 'http_latency',
            series_count: 1,
            series: [
              {
                metric: { service: 'payments' },
                points_count: 5,
                p95: 3500,
                avg: 1200,
                exemplars: [{ labels: { trace_id: 'trace-exemplar-123' } }]
              }
            ],
            finops: {
              raw_bytes_fetched: 5000,
              compacted_bytes_sent_to_llm: 500,
              payload_reduction_percent: 90,
              estimated_tokens_saved: 1125
            }
          };
        } else if (tool === 'query_loki_logs') {
          responseData = {
            logql: '{app="api"}',
            lines_count: 2,
            lines: ['log line 1', 'log line 2'],
            finops: {
              raw_bytes_fetched: 2000,
              compacted_bytes_sent_to_llm: 200,
              payload_reduction_percent: 90,
              estimated_tokens_saved: 450
            }
          };
        } else if (tool === 'inspect_git_deploy_diff') {
          responseData = {
            head_ref: 'commit-sha-abc',
            author_login: 'engineer1',
            commit_message: 'feat: pool change',
            files_changed: [{ filename: 'payment.ts', patch: '+ max: 10' }],
            suspect_file: { path: 'payment.ts', blob_sha: 'blob-123', content: 'code' },
            raw_bytes_fetched: 4000,
            compacted_bytes_sent_to_llm: 400,
            payload_reduction_percent: 90,
            estimated_tokens_saved: 900
          };
        }

        return {
          status: 200,
          ok: true,
          text: async () => '',
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [{ type: 'text', text: JSON.stringify(responseData) }],
              isError: false
            }
          })
        };
      });
      vi.stubGlobal('fetch', mockFetchSnake);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');

      const promRes = await adapter.executePromqlRange({ query: 'q', start: '', end: '' });
      expect(promRes.seriesCount).toBe(1);
      expect(promRes.exemplarTraceId).toBe('trace-exemplar-123');
      expect(promRes.summarizedSeries[0].p95).toBe(3500);
      expect(promRes.finops.rawBytesFetched).toBe(5000);

      const lokiRes = await adapter.queryLokiLogs({ logql: 'l', start: '', end: '' });
      expect(lokiRes.linesReturned).toBe(2);
      expect(lokiRes.logs[0].line).toBe('log line 1');

      const gitRes = await adapter.inspectGitDeployDiff({ base_ref: 'v1', head_ref: 'v2' });
      expect(gitRes.suspectCommitSha).toBe('commit-sha-abc');
      expect(gitRes.authorLogin).toBe('engineer1');
      expect(gitRes.suspectFilePath).toBe('payment.ts');
      expect(gitRes.currentBlobSha).toBe('blob-123');
      expect(gitRes.truncatedPatch).toBe('+ max: 10');
      expect(gitRes.finops.rawBytesFetched).toBe(4000);
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

    it('should return unreachable status and throw on trigger/reset failures', async () => {
      const mockFetchErr = vi.fn(async () => ({
        status: 500,
        ok: false,
        text: async () => 'Internal error',
        json: async () => ({})
      }));
      vi.stubGlobal('fetch', mockFetchErr);

      const adapter = new HttpTargetStatusAdapter('http://localhost:3000');
      const status = await adapter.getStatus();
      expect(status.status).toBe('unreachable');
      expect(status.version).toBe('unknown');

      await expect(adapter.triggerChaos(true)).rejects.toThrow(
        'Target app chaos trigger failed with status 500'
      );
      await expect(adapter.reset()).rejects.toThrow(
        'Target app chaos reset failed with status 500'
      );
    });
  });
});
