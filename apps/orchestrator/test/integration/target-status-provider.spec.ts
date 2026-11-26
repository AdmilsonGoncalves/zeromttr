import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
    teardownOrchestratorNock();
  });

  describe('HttpTargetStatusAdapter', () => {
    it('should fetch target manifest from configured ops status path', async () => {
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

    it('should fallback to legacy chaos status when ops status returns 404', async () => {
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

    it('should normalize legacy pool fields into generic saturation descriptor', async () => {
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

    it('should return unreachable with false capabilities on network failure', async () => {
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
    it('should build target status and live metrics from promql queries and env', async () => {
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

    it('should return degraded when 5xx ratio exceeds threshold', async () => {
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

    it('should report false chaos capabilities for passive prometheus targets', async () => {
      const adapter = new PrometheusTargetStatusAdapter(createMockToolsPort());
      const status = await adapter.getStatus();

      expect(status.capabilities).toEqual({
        chaosSimulation: false,
        healthyTrafficToggle: false
      });
    });

    it('should select prometheus provider when TARGET_STATUS_PROVIDER is prometheus', () => {
      process.env.TARGET_STATUS_PROVIDER = 'prometheus';
      const port = createTargetStatusPort(createMockToolsPort());
      expect(port).toBeInstanceOf(PrometheusTargetStatusAdapter);

      process.env.TARGET_STATUS_PROVIDER = 'manifest';
      const httpPort = createTargetStatusPort(createMockToolsPort());
      expect(httpPort).toBeInstanceOf(HttpTargetStatusAdapter);
    });
  });
});
