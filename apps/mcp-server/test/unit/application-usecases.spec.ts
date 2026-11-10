import { describe, it, expect, vi } from 'vitest';
import {
  ExecutePromqlRange,
  QueryLokiLogs,
  AnalyzeOtelTrace,
  SearchTracesByTraceQL,
  InspectGitDeployDiff,
  CreateRemediationPr,
  SendPostMortemResend,
  AnnotateGrafanaIncident,
  validateTimeRange
} from '../../src/application/index.js';
import type {
  MetricsPort,
  LogsPort,
  TracesPort,
  RepoInspectorPort,
  RemediationPort,
  NotifierPort,
  AnnotationPort
} from '../../src/ports/index.js';

describe('Application Use Cases Unit Tests', () => {
  describe('validateTimeRange', () => {
    it('should pass for valid window under 24h', () => {
      const start = '2026-11-09T10:00:00Z';
      const end = '2026-11-09T12:00:00Z';
      const range = validateTimeRange(start, end);
      expect(range.start.toISOString()).toBe('2026-11-09T10:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    });

    it('should reject invalid start date', () => {
      expect(() => validateTimeRange('invalid', '2026-11-09T12:00:00Z')).toThrow(
        /Invalid start timestamp/
      );
    });

    it('should reject invalid end date', () => {
      expect(() => validateTimeRange('2026-11-09T10:00:00Z', 'invalid')).toThrow(
        /Invalid end timestamp/
      );
    });

    it('should reject when start >= end', () => {
      expect(() => validateTimeRange('2026-11-09T12:00:00Z', '2026-11-09T10:00:00Z')).toThrow(
        /start .* must be before end/
      );
    });

    it('should reject window > 24 hours', () => {
      expect(() => validateTimeRange('2026-11-09T00:00:00Z', '2026-11-10T01:00:00Z')).toThrow(
        /exceeds maximum allowed window of 24h/
      );
    });
  });

  describe('ExecutePromqlRange', () => {
    it('should execute promql range query, summarize and return finops', async () => {
      const mockMetricsPort: MetricsPort = {
        queryRange: vi.fn().mockResolvedValue({
          rawBytes: 5000,
          series: [
            {
              metric: { job: 'test' },
              values: [[1700000000, '42']]
            }
          ]
        })
      };

      const useCase = new ExecutePromqlRange(mockMetricsPort);
      const out = await useCase.execute({
        query: 'rate(http_requests_total[5m])',
        start: '2026-11-09T10:00:00Z',
        end: '2026-11-09T11:00:00Z'
      });

      expect(out.query).toBe('rate(http_requests_total[5m])');
      expect(out.series_count).toBe(1);
      expect(out.series[0].latest).toBe(42);
      expect(out.finops.raw_bytes_fetched).toBe(5000);
      expect(out.finops.compacted_bytes_sent_to_llm).toBeGreaterThan(0);
      expect(out.finops.payload_reduction_percent).toBeGreaterThan(0);
    });
  });

  describe('QueryLokiLogs', () => {
    it('should query loki logs, truncate and return finops', async () => {
      const mockLogsPort: LogsPort = {
        queryLogs: vi.fn().mockResolvedValue({
          rawBytes: 8000,
          lines: ['[2026-11-09] Payment failed [REDACTED_CPF]']
        })
      };

      const useCase = new QueryLokiLogs(mockLogsPort);
      const out = await useCase.execute({
        logql: '{app="target-app-demo"}',
        start: '2026-11-09T10:00:00Z',
        end: '2026-11-09T11:00:00Z',
        limit: 50
      });

      expect(out.lines_count).toBe(1);
      expect(out.lines[0]).toContain('[REDACTED_CPF]');
      expect(out.finops.raw_bytes_fetched).toBe(8000);
    });
  });

  describe('AnalyzeOtelTrace', () => {
    it('should reject invalid trace_id format', async () => {
      const mockTracesPort: TracesPort = {
        getTrace: vi.fn(),
        searchTraces: vi.fn()
      };
      const useCase = new AnalyzeOtelTrace(mockTracesPort);
      await expect(useCase.execute({ trace_id: 'short-id' })).rejects.toThrow(
        /Must be a 32-character hexadecimal string/
      );
    });

    it('should analyze trace with valid hex id', async () => {
      const mockTracesPort: TracesPort = {
        getTrace: vi.fn().mockResolvedValue({
          rawBytes: 2000,
          spans: [
            {
              spanId: 's1',
              traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
              name: 'GET /pay',
              serviceName: 'pay-service',
              durationMs: 120,
              statusCode: 'OK'
            }
          ]
        }),
        searchTraces: vi.fn()
      };
      const useCase = new AnalyzeOtelTrace(mockTracesPort);
      const out = await useCase.execute({
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736'
      });

      expect(out.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(out.total_spans).toBe(1);
      expect(out.services_involved).toEqual(['pay-service']);
    });
  });

  describe('SearchTracesByTraceQL', () => {
    it('should search traces and clamp limit to 20', async () => {
      const mockTracesPort: TracesPort = {
        getTrace: vi.fn(),
        searchTraces: vi.fn().mockResolvedValue({
          rawBytes: 1000,
          traces: [{ traceId: 't1' }, { traceId: 't2' }]
        })
      };
      const useCase = new SearchTracesByTraceQL(mockTracesPort);
      const out = await useCase.execute({
        query: '{ status = error }',
        limit: 100
      });

      expect(mockTracesPort.searchTraces).toHaveBeenCalledWith('{ status = error }', 20);
      expect(out.count).toBe(2);
    });
  });

  describe('InspectGitDeployDiff', () => {
    it('should validate refs and delegate to port', async () => {
      const mockRepoPort: RepoInspectorPort = {
        inspectDeployDiff: vi.fn().mockResolvedValue({
          base_ref: 'v2.14.7',
          head_ref: 'v2.14.8',
          author_login: 'admilson',
          commit_message: 'feat: add bug',
          files_changed: [],
          raw_bytes_fetched: 3000,
          compacted_bytes_sent_to_llm: 500,
          payload_reduction_percent: 83.33,
          estimated_tokens_saved: 625
        })
      };

      const useCase = new InspectGitDeployDiff(mockRepoPort);
      const out = await useCase.execute({
        base_ref: 'v2.14.7',
        head_ref: 'v2.14.8'
      });

      expect(out.author_login).toBe('admilson');
      expect(out.payload_reduction_percent).toBe(83.33);
    });

    it('should reject missing refs', async () => {
      const mockRepoPort: RepoInspectorPort = {
        inspectDeployDiff: vi.fn()
      };
      const useCase = new InspectGitDeployDiff(mockRepoPort);
      await expect(useCase.execute({ base_ref: '', head_ref: 'v2.14.8' })).rejects.toThrow(
        /Both base_ref and head_ref are required/
      );
    });
  });

  describe('CreateRemediationPr', () => {
    it('should validate inputs and reasoning_source', async () => {
      const mockRemediationPort: RemediationPort = {
        createPullRequest: vi.fn().mockResolvedValue({
          branchName: 'hotfix/zeromttr-123',
          branchUrl: 'https://github.com/...',
          pullRequestUrl: 'https://github.com/.../pull/1',
          commitSha: 'c123'
        })
      };

      const useCase = new CreateRemediationPr(mockRemediationPort);
      const receipt = await useCase.execute({
        incident_id: '123',
        file_path: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        patched_content: 'console.log("fixed");',
        title: 'fix(target-app-demo): connection leak',
        rca_markdown: 'Pool exhaustion',
        reasoning_source: 'llm'
      });

      expect(receipt.branchName).toBe('hotfix/zeromttr-123');
    });

    it('should reject invalid reasoning_source', async () => {
      const mockRemediationPort: RemediationPort = {
        createPullRequest: vi.fn()
      };
      const useCase = new CreateRemediationPr(mockRemediationPort);
      await expect(
        useCase.execute({
          incident_id: '123',
          file_path: 'file.ts',
          patched_content: 'fix',
          title: 'title',
          rca_markdown: 'rca',
          // @ts-expect-error test invalid source
          reasoning_source: 'invalid'
        })
      ).rejects.toThrow(/reasoning_source must be either 'llm' or 'fallback'/);
    });
  });

  describe('SendPostMortemResend', () => {
    it('should delegate to notifierPort and validate required links', async () => {
      const mockNotifierPort: NotifierPort = {
        sendPostMortem: vi.fn().mockResolvedValue({
          id: 'msg-123',
          delivered: true
        })
      };

      const useCase = new SendPostMortemResend(mockNotifierPort);
      const res = await useCase.execute({
        incident_id: 'inc-1',
        title: 'Post-mortem Incident inc-1',
        rca_summary: 'Connection leak',
        evidence_coverage: '4/4 Signals — 100%',
        reasoning_source: 'llm',
        blast_radius: ['api-pagamentos-core'],
        regression_commit: 'v2.14.7...v2.14.8',
        pull_request_url: 'https://github.com/pull/1',
        approve_url: 'http://localhost:4200/decision/inc-1#action=approve&sig=abc&exp=123',
        reject_url: 'http://localhost:4200/decision/inc-1#action=reject&sig=def&exp=123'
      });

      expect(res.delivered).toBe(true);
      expect(res.id).toBe('msg-123');
    });
  });

  describe('AnnotateGrafanaIncident', () => {
    it('should ensure aiops-remediation tag is added to annotation', async () => {
      const mockAnnotationPort: AnnotationPort = {
        createAnnotation: vi.fn().mockResolvedValue({
          id: 42,
          message: 'Annotation added'
        })
      };

      const useCase = new AnnotateGrafanaIncident(mockAnnotationPort);
      const res = await useCase.execute({
        text: 'Remediation PR opened',
        tags: ['custom-tag']
      });

      expect(mockAnnotationPort.createAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['custom-tag', 'aiops-remediation'])
        })
      );
      expect(res.id).toBe(42);
    });

    it('should reject empty annotation text', async () => {
      const mockAnnotationPort: AnnotationPort = {
        createAnnotation: vi.fn()
      };
      const useCase = new AnnotateGrafanaIncident(mockAnnotationPort);
      await expect(useCase.execute({ text: '  ' })).rejects.toThrow(
        /Annotation text must not be empty/
      );
    });
  });
});
