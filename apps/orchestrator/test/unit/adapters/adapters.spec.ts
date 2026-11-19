import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nock from 'nock';
import {
  McpClientAdapter,
  FileIncidentRepository,
  HttpTargetStatusAdapter,
  DeterministicFallbackReasoningAdapter,
  TypeScriptPatchSyntaxValidator
} from '../../../src/adapters/index.js';
import { HttpDemoControlAdapter } from '../../../src/demo/index.js';
import { Incident, IncidentState } from '../../../src/domain/index.js';
import type { CollectedEvidence } from '../../../src/ports/index.js';

describe('Adapters Unit Tests', () => {
  const tempDir = path.join(os.tmpdir(), `zeromttr-adapters-test-${process.pid}`);
  const tempFile = path.join(tempDir, 'incidents.json');

  const savedEnv: Partial<Record<string, string | undefined>> = {};

  function setIsolatedEnv(overrides: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(overrides)) {
      if (!(key in savedEnv)) {
        savedEnv[key] = process.env[key];
      }
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    nock.cleanAll();
    nock.enableNetConnect();
    for (const [key, original] of Object.entries(savedEnv)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
      delete savedEnv[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('DeterministicFallbackReasoningAdapter', () => {
    it('should synthesize domain-agnostic fallback or use configured patchTemplate without hardcoding target app logic', async () => {
      const customPatch = 'export const fixed = true;';
      const configuredAdapter = new DeterministicFallbackReasoningAdapter({
        patchTemplate: customPatch
      });
      const genericAdapter = new DeterministicFallbackReasoningAdapter();
      const evidence: CollectedEvidence = {
        incidentId: 'inc-001',
        service: 'billing-worker',
        alertName: 'HighLatency',
        promqlSummary: { metric: 'm' },
        traceAnalysis: {
          traceId: 'trace-456',
          criticalOperation: 'op',
          durationMs: 10,
          servicesInvolved: ['billing-worker']
        },
        logSample: 'log',
        gitDiff: {
          baseRef: 'v1',
          headRef: 'v2',
          suspectCommit: 'commit-789',
          authorLogin: 'bot',
          suspectFilePath: 'src/worker/pool.ts',
          patch: '- pool: 10\n+ pool: 2'
        }
      };

      const configuredSynthesis = await configuredAdapter.synthesizeRcaAndPatch(evidence);
      expect(configuredSynthesis.reasoningSource).toBe('fallback');
      expect(configuredSynthesis.suspectFilePath).toBe('src/worker/pool.ts');
      expect(configuredSynthesis.patchedContent).toBe(customPatch);
      expect(configuredSynthesis.evidenceRefs).toContain('trace-456');

      const genericSynthesis = await genericAdapter.synthesizeRcaAndPatch(evidence);
      expect(genericSynthesis.reasoningSource).toBe('fallback');
      expect(genericSynthesis.suspectFilePath).toBe('src/worker/pool.ts');
      expect(genericSynthesis.patchedContent).toContain('src/worker/pool.ts');
      expect(genericSynthesis.patchedContent).toContain('commit-789');
      expect(genericSynthesis.patchedContent).not.toContain('api-pagamentos-core');
    });

    it('should fetch healthy baseline source from GitHub Contents API with preserved slashes and TARGET_GITHUB_REPO fallback', async () => {
      nock.disableNetConnect();
      const healthySource = 'export const pool = { max: 10 };\n';
      const encoded = Buffer.from(healthySource, 'utf-8').toString('base64');

      const scope = nock('https://api.github.com')
        .get(
          '/repos/AdmilsonGoncalves/zeromttr/contents/apps/target-app-demo/src/repositories/payment.repository.ts'
        )
        .query({ ref: 'v2.14.7' })
        .matchHeader('Authorization', 'Bearer ghp_test_token')
        .reply(200, {
          encoding: 'base64',
          content: encoded
        });

      setIsolatedEnv({
        GITHUB_OWNER: undefined,
        GITHUB_REPO: undefined,
        GITHUB_API_BASE_URL: undefined,
        TARGET_GITHUB_REPO: 'https://github.com/AdmilsonGoncalves/zeromttr',
        GITHUB_TOKEN: 'ghp_test_token'
      });

      const adapter = new DeterministicFallbackReasoningAdapter();

      const result = await adapter.synthesizeRcaAndPatch({
        incidentId: 'inc-gh-fallback',
        service: 'payments-service',
        alertName: 'PoolExhausted',
        promqlSummary: { metric: 'm' },
        traceAnalysis: {
          traceId: 'trace-1',
          criticalOperation: 'pg.pool.acquire',
          durationMs: 4200,
          servicesInvolved: ['payments-service']
        },
        logSample: 'Pool exhausted',
        gitDiff: {
          baseRef: 'v2.14.7',
          headRef: 'v2.14.8',
          suspectCommit: '8f14e45',
          authorLogin: 'dev',
          suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
          patch: '- max: 10\n+ max: 2'
        }
      });

      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('fallback');
      expect(result.patchedContent).toBe(healthySource);
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

    it('should properly map RawSpan fields (name, statusCode, statusMessage) in analyzeOtelTrace', async () => {
      const mockFetchTrace = vi.fn(async () => ({
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
                  trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
                  services_involved: ['api-pagamentos-core', 'postgres'],
                  root_span: {
                    spanId: 'span-root',
                    serviceName: 'api-pagamentos-core',
                    name: 'POST /payments',
                    durationMs: 4620,
                    statusCode: 'ERROR'
                  },
                  top_errors: [
                    {
                      spanId: 'span-db-err',
                      parentSpanId: 'span-root',
                      serviceName: 'postgres',
                      name: 'pg.pool.acquire',
                      durationMs: 4510,
                      statusCode: 2,
                      statusMessage: 'KnexTimeoutError: pool exhausted'
                    },
                    {
                      spanId: 'span-http-err',
                      parentSpanId: 'span-root',
                      serviceName: 'api-pagamentos-core',
                      name: 'gateway.dispatch',
                      durationMs: 120,
                      statusCode: 'STATUS_CODE_ERROR',
                      attributes: { error: true }
                    }
                  ],
                  top_slowest: []
                })
              }
            ],
            isError: false
          }
        })
      }));
      vi.stubGlobal('fetch', mockFetchTrace);

      const adapter = new McpClientAdapter('http://localhost:8000/mcp', 'token-123');
      const trace = await adapter.analyzeOtelTrace({
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736'
      });

      expect(trace.rootServiceName).toBe('api-pagamentos-core');
      expect(trace.totalDurationMs).toBe(4620);
      expect(trace.criticalSpans).toHaveLength(2);
      expect(trace.criticalSpans?.[0]).toEqual({
        spanId: 'span-db-err',
        parentSpanId: 'span-root',
        serviceName: 'postgres',
        operationName: 'pg.pool.acquire',
        durationMs: 4510,
        hasError: true,
        errorMessage: 'KnexTimeoutError: pool exhausted'
      });
      expect(trace.criticalSpans?.[1]?.hasError).toBe(true);
    });
  });

  describe('TypeScriptPatchSyntaxValidator', () => {
    it('should validate TS, JSX, ambient TS declarations, and reject JS early/grammar errors', () => {
      const validator = new TypeScriptPatchSyntaxValidator();

      expect(validator.isValidSyntax('worker.js', 'export const x = 1;\nexport { x };')).toBe(true);
      expect(validator.isValidSyntax('worker.js', 'export const x;')).toBe(false);
      expect(validator.isValidSyntax('worker.js', 'const count: number = 1;')).toBe(false);
      expect(validator.isValidSyntax('ambient.ts', 'declare const x: number;')).toBe(true);
      expect(validator.isValidSyntax('view.jsx', 'export const View = () => <div />;')).toBe(true);
      expect(validator.isValidSyntax('view.jsx', 'export const View = () => <div>;')).toBe(false);
    });
  });

  describe('HttpTargetStatusAdapter & HttpDemoControlAdapter', () => {
    it('should query target app chaos status and trigger/reset chaos via HttpDemoControlAdapter', async () => {
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

      const statusAdapter = new HttpTargetStatusAdapter('http://localhost:3000');
      const status = await statusAdapter.getStatus();
      expect(status.status).toBe('degraded');

      const demoAdapter = new HttpDemoControlAdapter('http://localhost:3000');
      await demoAdapter.triggerChaos(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chaos/pool-saturation?enable=true'),
        expect.any(Object)
      );

      await demoAdapter.reset();
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

      const statusAdapter = new HttpTargetStatusAdapter('http://localhost:3000');
      const status = await statusAdapter.getStatus();
      expect(status.status).toBe('unreachable');
      expect(status.version).toBe('unknown');

      const demoAdapter = new HttpDemoControlAdapter('http://localhost:3000');
      await expect(demoAdapter.triggerChaos(true)).rejects.toThrow(
        'Target app chaos trigger failed with status 500'
      );
      await expect(demoAdapter.reset()).rejects.toThrow(
        'Target app chaos reset failed with status 500'
      );
    });
  });
});
