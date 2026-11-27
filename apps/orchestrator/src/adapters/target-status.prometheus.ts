import { isNumber, parseNumber, round } from '@zeromttr/utils';
import { OrchestratorDefault, TargetHealthStatus } from '../domain/incident-enums.js';
import { resolveTargetRepoUrl } from '../domain/target-repo-url.js';
import type { TargetStatus, TargetStatusPort } from '../ports/target-status.port.js';
import type { PromqlRangeOutput, ToolsPort } from '../ports/tools.port.js';
import { HttpTargetStatusAdapter } from './target-status.http.js';

export interface PrometheusTargetStatusConfig {
  serviceName?: string;
  version?: string;
  previousHealthyVersion?: string;
  targetRepo?: string;
  suspectFilePath?: string;
  errorRateThresholdPercent?: number;
  getErrorRateThreshold?: () => number;
  getDiffRefs?: () => { targetBaseRef: string; targetHeadRef: string };
}

interface ResolvedPrometheusTargetMetadata {
  service: string;
  version: string;
  previousHealthyVersion: string;
  targetRepo: string;
  suspectFilePath: string;
  errorThreshold: number;
}

interface TargetPromqlQueries {
  rpsQuery: string;
  errorRatioQuery: string;
  p95Query: string;
}

const DEFAULT_ERROR_RATE_THRESHOLD_PERCENT = 5;
const PROMQL_WINDOW_MS = 2 * 60 * 1000;
const PASSIVE_CAPABILITIES = {
  chaosSimulation: false,
  healthyTrafficToggle: false
} as const;

function extractMetricSample(output: PromqlRangeOutput): number {
  const firstSeries = output.summarizedSeries[0];
  if (!firstSeries) {
    return 0;
  }
  const value = firstSeries.latest ?? firstSeries.p95 ?? firstSeries.p50 ?? firstSeries.max ?? 0;
  return isNumber(value) ? Math.max(0, value) : 0;
}

function resolveTargetMetadata(
  config: PrometheusTargetStatusConfig
): ResolvedPrometheusTargetMetadata {
  const dynamicRefs = config.getDiffRefs?.();
  return {
    service:
      config.serviceName || process.env.TARGET_SERVICE_NAME || OrchestratorDefault.UNKNOWN_SERVICE,
    version:
      config.version ||
      dynamicRefs?.targetHeadRef ||
      process.env.TARGET_VERSION ||
      OrchestratorDefault.UNKNOWN,
    previousHealthyVersion:
      config.previousHealthyVersion ||
      dynamicRefs?.targetBaseRef ||
      process.env.TARGET_PREVIOUS_VERSION ||
      OrchestratorDefault.UNKNOWN,
    targetRepo: config.targetRepo || resolveTargetRepoUrl(),
    suspectFilePath: config.suspectFilePath ?? process.env.TARGET_SUSPECT_FILE_PATH ?? '',
    errorThreshold:
      config.getErrorRateThreshold?.() ??
      config.errorRateThresholdPercent ??
      parseNumber(
        process.env.TARGET_ERROR_RATE_THRESHOLD_PERCENT,
        DEFAULT_ERROR_RATE_THRESHOLD_PERCENT
      )
  };
}

function escapePromqlLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildTargetPromqlQueries(service: string): TargetPromqlQueries {
  const escapedService = escapePromqlLabelValue(service);
  const totalRateExpr = `(sum(rate(http_server_duration_milliseconds_count{service_name="${escapedService}"}[1m])) or sum(rate(http_request_duration_seconds_count{service="${escapedService}"}[1m])))`;
  const errorRateExpr = `(sum(rate(http_server_duration_milliseconds_count{service_name="${escapedService}",http_status_code=~"5.."}[1m])) or sum(rate(http_request_duration_seconds_count{service="${escapedService}",status=~"5.."}[1m])) or vector(0))`;

  return {
    rpsQuery: totalRateExpr,
    errorRatioQuery: `((100 * ${errorRateExpr}) / (${totalRateExpr} > 0)) or vector(0)`,
    p95Query: `(histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket{service_name="${escapedService}"}[1m])) by (le))) or (1000 * histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${escapedService}"}[1m])) by (le)))`
  };
}

function buildUnreachableStatus(metadata: ResolvedPrometheusTargetMetadata): TargetStatus {
  return {
    status: TargetHealthStatus.UNREACHABLE,
    service: metadata.service,
    version: metadata.version,
    previousHealthyVersion: metadata.previousHealthyVersion,
    targetRepo: metadata.targetRepo,
    suspectFilePath: metadata.suspectFilePath,
    capabilities: { ...PASSIVE_CAPABILITIES },
    rawEdgeLogPreCollector: ''
  };
}

function hasUsableSamples(output: PromqlRangeOutput): boolean {
  return output.summarizedSeries.some((series) => (series.sampleCount ?? 1) > 0);
}

function evaluatePrometheusTelemetry(
  metadata: ResolvedPrometheusTargetMetadata,
  rpsOut: PromqlRangeOutput,
  errorOut: PromqlRangeOutput,
  p95Out: PromqlRangeOutput
): TargetStatus {
  const hasObservedTelemetry = hasUsableSamples(rpsOut) || hasUsableSamples(p95Out);
  if (!hasObservedTelemetry) {
    return buildUnreachableStatus(metadata);
  }

  const requestsPerSecond = round(extractMetricSample(rpsOut), 2);
  const errorRate5xxPercent = Math.min(100, round(extractMetricSample(errorOut), 2));
  const p95LatencyMs = round(extractMetricSample(p95Out), 2);
  const isDegraded = errorRate5xxPercent > metadata.errorThreshold;

  return {
    status: isDegraded ? TargetHealthStatus.DEGRADED : TargetHealthStatus.HEALTHY,
    service: metadata.service,
    version: metadata.version,
    previousHealthyVersion: metadata.previousHealthyVersion,
    targetRepo: metadata.targetRepo,
    suspectFilePath: metadata.suspectFilePath,
    capabilities: { ...PASSIVE_CAPABILITIES },
    rawEdgeLogPreCollector: '',
    metrics: {
      requestsPerSecond,
      errorRate5xxPercent,
      p95LatencyMs,
      healthyTrafficActive: false
    }
  };
}

/**
 * Passive TargetStatusPort adapter synthesizing workload health and live metrics via Prometheus MCP queries.
 */
export class PrometheusTargetStatusAdapter implements TargetStatusPort {
  public constructor(
    private readonly toolsPort: ToolsPort,
    private readonly config: PrometheusTargetStatusConfig = {}
  ) {}

  /**
   * Queries Prometheus via `ToolsPort` for throughput, 5xx ratio, and p95 latency without requiring target API endpoints.
   */
  public async getStatus(): Promise<TargetStatus> {
    const metadata = resolveTargetMetadata(this.config);
    const queries = buildTargetPromqlQueries(metadata.service);
    const endMs = Date.now();
    const range = {
      start: new Date(endMs - PROMQL_WINDOW_MS).toISOString(),
      end: new Date(endMs).toISOString(),
      step: '30s'
    };

    try {
      const [rpsOut, errorOut, p95Out] = await Promise.all([
        this.toolsPort.executePromqlRange({ query: queries.rpsQuery, ...range }),
        this.toolsPort.executePromqlRange({ query: queries.errorRatioQuery, ...range }),
        this.toolsPort.executePromqlRange({ query: queries.p95Query, ...range })
      ]);

      return evaluatePrometheusTelemetry(metadata, rpsOut, errorOut, p95Out);
    } catch {
      return buildUnreachableStatus(metadata);
    }
  }
}

/**
 * Selects the configured `TargetStatusPort` provider (`manifest` or `prometheus`).
 */
export function createTargetStatusPort(
  toolsPort: ToolsPort,
  config?: PrometheusTargetStatusConfig
): TargetStatusPort {
  const provider = (process.env.TARGET_STATUS_PROVIDER || 'manifest').trim().toLowerCase();
  if (provider === 'prometheus') {
    return new PrometheusTargetStatusAdapter(toolsPort, config);
  }
  return new HttpTargetStatusAdapter();
}
