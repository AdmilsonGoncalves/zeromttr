import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { HttpTargetStatusAdapter } from '../../src/adapters/target-status.http.js';
import {
  PrometheusTargetStatusAdapter,
  createTargetStatusPort
} from '../../src/adapters/target-status.prometheus.js';
import { TargetHealthStatus } from '../../src/domain/incident-enums.js';
import {
  TEST_TARGET_APP_URL,
  cleanOrchestratorNock,
  setupOrchestratorNock,
  teardownOrchestratorNock
} from '../helpers/nock.helper.js';
import { createMockFinOpsData, createMockToolsPort } from '../helpers/test-doubles.helper.js';

describe('Target Status Providers (HttpTargetStatusAdapter & PrometheusTargetStatusAdapter)', () => {
  const envKeys = [
    'TARGET_STATUS_PROVIDER',
    'TARGET_STATUS_PATH',
    'TARGET_SERVICE_NAME',
    'TARGET_VERSION',
    'TARGET_PREVIOUS_VERSION',
    'TARGET_BASE_REF',
    'TARGET_HEAD_REF',
    'TARGET_REPO_URL',
    'TARGET_SUSPECT_FILE_PATH'
  ] as const;

  const savedEnv = new Map<string, string | undefined>();

  beforeAll(() => {
    setupOrchestratorNock();
    for (const key of envKeys) {
      savedEnv.set(key, process.env[key]);
    }
  });

  beforeEach(() => {
    delete process.env.TARGET_STATUS_PATH;
  });

  afterEach(() => {
    cleanOrchestratorNock();
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    teardownOrchestratorNock();
  });

  describe('HttpTargetStatusAdapter', () => {
    it('should_fetch_target_manifest_from_configured_ops_status_path', async () => {
      process.env.TARGET_STATUS_PATH = '/custom/ops-manifest';

      nock(TEST_TARGET_APP_URL)
        .get('/custom/ops-manifest')
        .reply(HTTP_STATUS.OK, {
          status: TargetHealthStatus.HEALTHY,
          service: 'shipping-dispatcher',
          version: 'v4.2.0',
          previousHealthyVersion: 'v4.1.9',
          targetRepo: 'https://github.com/org/shipping-dispatcher',
          suspectFilePath: 'src/workers/dispatch.ts',
          capabilities: {
            chaosSimulation: true,
            healthyTrafficToggle: false
          },
          metrics: {
            requestsPerSecond: 42.5,
            errorRate5xxPercent: 0.2,
            p95LatencyMs: 85,
            healthyTrafficActive: false,
            saturation: {
              resourceLabel: 'Worker Queue',
              active: 4,
              waiting: 1,
              max: 20
            }
          }
        });

      const adapter = new HttpTargetStatusAdapter(TEST_TARGET_APP_URL);
      const result = await adapter.getStatus();

      expect(result).toMatchObject({
        status: TargetHealthStatus.HEALTHY,
        service: 'shipping-dispatcher',
        version: 'v4.2.0',
        previousHealthyVersion: 'v4.1.9',
        targetRepo: 'https://github.com/org/shipping-dispatcher',
        suspectFilePath: 'src/workers/dispatch.ts',
        capabilities: {
          chaosSimulation: true,
          healthyTrafficToggle: false
        },
        metrics: {
          requestsPerSecond: 42.5,
          errorRate5xxPercent: 0.2,
          p95LatencyMs: 85,
          healthyTrafficActive: false,
          saturation: {
            resourceLabel: 'Worker Queue',
            active: 4,
            waiting: 1,
            max: 20
          }
        }
      });
    });

    it('should_fallback_to_legacy_chaos_status_when_ops_status_returns_404', async () => {
      nock(TEST_TARGET_APP_URL)
        .get('/ops/status')
        .reply(HTTP_STATUS.NOT_FOUND, { error: 'Not Found' });
      nock(TEST_TARGET_APP_URL).get('/chaos/status').reply(HTTP_STATUS.OK, {
        status: TargetHealthStatus.DEGRADED,
        service: 'api-pagamentos-core',
        version: 'v2.14.8',
        previousHealthyVersion: 'v2.14.7',
        targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
        suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
        rawEdgeLogPreCollector: 'ERROR raw'
      });

      const adapter = new HttpTargetStatusAdapter(TEST_TARGET_APP_URL);
      const result = await adapter.getStatus();

      expect(result.status).toBe(TargetHealthStatus.DEGRADED);
      expect(result.service).toBe('api-pagamentos-core');
      expect(result.capabilities).toEqual({
        chaosSimulation: false,
        healthyTrafficToggle: false
      });
    });

    it('should_normalize_legacy_pool_fields_into_generic_saturation_descriptor', async () => {
      nock(TEST_TARGET_APP_URL)
        .get('/ops/status')
        .reply(HTTP_STATUS.OK, {
          status: TargetHealthStatus.DEGRADED,
          service: 'api-pagamentos-core',
          version: 'v2.14.8',
          previousHealthyVersion: 'v2.14.7',
          metrics: {
            requestsPerSecond: 12.4,
            errorRate5xxPercent: 80,
            p95LatencyMs: 4610,
            poolActive: 2,
            poolWaiting: 9,
            poolMax: 2,
            healthyTrafficActive: true
          }
        });

      const adapter = new HttpTargetStatusAdapter(TEST_TARGET_APP_URL);
      const result = await adapter.getStatus();

      expect(result.metrics?.saturation).toEqual({
        resourceLabel: 'DB Pool',
        active: 2,
        waiting: 9,
        max: 2
      });
    });

    it('should_return_unreachable_with_false_capabilities_on_network_failure', async () => {
      nock(TEST_TARGET_APP_URL).get('/ops/status').replyWithError('ECONNREFUSED');

      const adapter = new HttpTargetStatusAdapter(TEST_TARGET_APP_URL);
      const result = await adapter.getStatus();

      expect(result.status).toBe(TargetHealthStatus.UNREACHABLE);
      expect(result.capabilities).toEqual({
        chaosSimulation: false,
        healthyTrafficToggle: false
      });
    });
  });

  describe('PrometheusTargetStatusAdapter', () => {
    it('should_build_target_status_and_live_metrics_from_promql_queries_and_env', async () => {
      process.env.TARGET_SERVICE_NAME = 'orders-api';
      process.env.TARGET_VERSION = 'v5.0.1';
      process.env.TARGET_PREVIOUS_VERSION = 'v5.0.0';
      process.env.TARGET_REPO_URL = 'https://github.com/org/orders-api';
      process.env.TARGET_SUSPECT_FILE_PATH = 'src/orders.service.ts';

      const executePromqlRange = vi.fn(async ({ query }: { query: string }) => {
        if (query.includes('histogram_quantile')) {
          return {
            seriesCount: 1,
            summarizedSeries: [{ metric: {}, latest: 145, p95: 145, max: 180 }],
            finops: createMockFinOpsData()
          };
        }
        if (query.includes('5..')) {
          return {
            seriesCount: 1,
            summarizedSeries: [{ metric: {}, latest: 0.5, p95: 0.5, max: 1 }],
            finops: createMockFinOpsData()
          };
        }
        return {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, latest: 34.2, p95: 34.2, max: 40 }],
          finops: createMockFinOpsData()
        };
      });

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange })
      );
      const status = await adapter.getStatus();

      expect(status).toMatchObject({
        status: TargetHealthStatus.HEALTHY,
        service: 'orders-api',
        version: 'v5.0.1',
        previousHealthyVersion: 'v5.0.0',
        targetRepo: 'https://github.com/org/orders-api',
        suspectFilePath: 'src/orders.service.ts',
        metrics: {
          requestsPerSecond: 34.2,
          errorRate5xxPercent: 0.5,
          p95LatencyMs: 145,
          healthyTrafficActive: false
        }
      });
      expect(status.metrics?.saturation).toBeUndefined();
    });

    it('should_return_degraded_when_5xx_ratio_exceeds_threshold', async () => {
      process.env.TARGET_SERVICE_NAME = 'orders-api';

      const executePromqlRange = vi.fn(async ({ query }: { query: string }) => {
        if (query.includes('5..')) {
          return {
            seriesCount: 1,
            summarizedSeries: [{ metric: {}, latest: 24.5, p95: 24.5, max: 30 }],
            finops: createMockFinOpsData()
          };
        }
        return {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, latest: 1200, p95: 1200, max: 1500 }],
          finops: createMockFinOpsData()
        };
      });

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange })
      );
      const status = await adapter.getStatus();

      expect(status.status).toBe(TargetHealthStatus.DEGRADED);
      expect(status.metrics?.errorRate5xxPercent).toBe(24.5);
    });

    it('should_report_false_chaos_capabilities_for_passive_prometheus_targets', async () => {
      const adapter = new PrometheusTargetStatusAdapter(createMockToolsPort());
      const status = await adapter.getStatus();

      expect(status.capabilities).toEqual({
        chaosSimulation: false,
        healthyTrafficToggle: false
      });
    });

    it('should_return_unreachable_when_prometheus_returns_no_http_metric_series', async () => {
      process.env.TARGET_SERVICE_NAME = 'missing-service';
      const executePromqlRange = vi.fn(async () => ({
        seriesCount: 0,
        summarizedSeries: [],
        finops: createMockFinOpsData()
      }));

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange })
      );
      const status = await adapter.getStatus();

      expect(status.status).toBe(TargetHealthStatus.UNREACHABLE);
      expect(status.metrics).toBeUndefined();
    });

    it('should_preserve_actual_low_rps_denominator_without_clamp_min_one_in_error_ratio_query', async () => {
      process.env.TARGET_SERVICE_NAME = 'low-rps-service';
      const capturedQueries: string[] = [];
      const executePromqlRange = vi.fn(async ({ query }: { query: string }) => {
        capturedQueries.push(query);
        if (query.includes('5..')) {
          return {
            seriesCount: 1,
            summarizedSeries: [{ metric: {}, latest: 100, p95: 100, max: 100 }],
            finops: createMockFinOpsData()
          };
        }
        return {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, latest: 0.04, p95: 0.04, max: 0.04 }],
          finops: createMockFinOpsData()
        };
      });

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange })
      );
      const status = await adapter.getStatus();

      const errorQuery = capturedQueries.find((q) => q.includes('5..')) ?? '';
      expect(errorQuery).not.toContain('clamp_min');
      expect(errorQuery).toContain('> 0');
      expect(status.status).toBe(TargetHealthStatus.DEGRADED);
      expect(status.metrics?.errorRate5xxPercent).toBe(100);
    });

    it('should_report_HEALTHY_with_zero_error_rate_when_prometheus_has_rps_and_latency_but_no_5xx_series', async () => {
      process.env.TARGET_SERVICE_NAME = 'healthy-orders-api';
      const executePromqlRange = vi.fn(async ({ query }: { query: string }) => {
        if (query.includes('5..')) {
          return {
            seriesCount: 0,
            summarizedSeries: [],
            finops: createMockFinOpsData()
          };
        }
        if (query.includes('histogram_quantile')) {
          return {
            seriesCount: 1,
            summarizedSeries: [{ metric: {}, latest: 42, p95: 42, max: 60 }],
            finops: createMockFinOpsData()
          };
        }
        return {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, latest: 1, p95: 1, max: 1 }],
          finops: createMockFinOpsData()
        };
      });

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange })
      );
      const status = await adapter.getStatus();

      expect(status.status).toBe(TargetHealthStatus.HEALTHY);
      expect(status.metrics).toMatchObject({
        requestsPerSecond: 1,
        errorRate5xxPercent: 0,
        p95LatencyMs: 42
      });
    });

    it('should_prefer_dynamic_diff_refs_callback_over_static_env_refs', async () => {
      process.env.TARGET_SERVICE_NAME = 'orders-api';
      process.env.TARGET_PREVIOUS_VERSION = 'v1.0.0-env';
      process.env.TARGET_VERSION = 'v1.0.1-env';

      const executePromqlRange = vi.fn(async () => ({
        seriesCount: 1,
        summarizedSeries: [{ metric: {}, latest: 10, p95: 10, max: 10 }],
        finops: createMockFinOpsData()
      }));

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange }),
        {
          getDiffRefs: () => ({
            targetBaseRef: 'v2.9.0-runtime',
            targetHeadRef: 'v2.9.1-runtime'
          })
        }
      );
      const status = await adapter.getStatus();

      expect(status.previousHealthyVersion).toBe('v2.9.0-runtime');
      expect(status.version).toBe('v2.9.1-runtime');
    });

    it('should_escape_quotes_and_backslashes_in_service_name_for_promql_queries', async () => {
      const capturedQueries: string[] = [];
      const executePromqlRange = vi.fn(async ({ query }: { query: string }) => {
        capturedQueries.push(query);
        return {
          seriesCount: 1,
          summarizedSeries: [{ metric: {}, latest: 1, p95: 1, max: 1 }],
          finops: createMockFinOpsData()
        };
      });

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange }),
        {
          serviceName: 'orders\\"api'
        }
      );
      await adapter.getStatus();

      expect(capturedQueries).toHaveLength(3);
      for (const query of capturedQueries) {
        expect(query).toContain('service_name="orders\\\\\\"api"');
        expect(query).toContain('service="orders\\\\\\"api"');
      }
    });

    it('should_report_unreachable_when_prometheus_series_have_zero_usable_samples', async () => {
      const executePromqlRange = vi.fn(async () => ({
        seriesCount: 1,
        summarizedSeries: [{ metric: {}, latest: 0, p95: 0, max: 0, sampleCount: 0 }],
        finops: createMockFinOpsData()
      }));

      const adapter = new PrometheusTargetStatusAdapter(
        createMockToolsPort({ executePromqlRange }),
        { serviceName: 'zero-samples-service' }
      );
      const status = await adapter.getStatus();
      expect(status.status).toBe(TargetHealthStatus.UNREACHABLE);
    });

    it('should_select_prometheus_provider_when_TARGET_STATUS_PROVIDER_is_prometheus', () => {
      process.env.TARGET_STATUS_PROVIDER = 'prometheus';
      const port = createTargetStatusPort(createMockToolsPort());
      expect(port).toBeInstanceOf(PrometheusTargetStatusAdapter);

      process.env.TARGET_STATUS_PROVIDER = 'manifest';
      const httpPort = createTargetStatusPort(createMockToolsPort());
      expect(httpPort).toBeInstanceOf(HttpTargetStatusAdapter);
    });
  });
});
