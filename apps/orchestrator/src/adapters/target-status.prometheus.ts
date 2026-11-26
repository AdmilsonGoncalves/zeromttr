import { parseNumber, round } from '@zeromttr/utils';
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
}

const DEFAULT_ERROR_RATE_THRESHOLD_PERCENT = 5;
const PROMQL_WINDOW_MS = 2 * 60 * 1000;

function extractMetricSample(output: PromqlRangeOutput): number {
  const firstSeries = output.summarizedSeries[0];
  if (!firstSeries) {
    return 0;
  }
  const value = firstSeries.latest ?? firstSeries.p95 ?? firstSeries.p50 ?? firstSeries.max ?? 0;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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
    const service =
      this.config.serviceName ||
      process.env.TARGET_SERVICE_NAME ||
      OrchestratorDefault.UNKNOWN_SERVICE;
    const version =
      this.config.version ||
      process.env.TARGET_VERSION ||
      process.env.TARGET_HEAD_REF ||
      OrchestratorDefault.UNKNOWN;
    const previousHealthyVersion =
      this.config.previousHealthyVersion ||
      process.env.TARGET_PREVIOUS_VERSION ||
      process.env.TARGET_BASE_REF ||
      OrchestratorDefault.UNKNOWN;
    const targetRepo = this.config.targetRepo || resolveTargetRepoUrl();
    const suspectFilePath =
      this.config.suspectFilePath ?? process.env.TARGET_SUSPECT_FILE_PATH ?? '';
    const errorThreshold =
      this.config.errorRateThresholdPercent ??
      parseNumber(
        process.env.TARGET_ERROR_RATE_THRESHOLD_PERCENT,
        DEFAULT_ERROR_RATE_THRESHOLD_PERCENT
      );

    const endMs = Date.now();
    const startIso = new Date(endMs - PROMQL_WINDOW_MS).toISOString();
    const endIso = new Date(endMs).toISOString();

    const rpsQuery = `sum(rate(http_server_duration_milliseconds_count{service_name="${service}"}[1m])) or sum(rate(http_request_duration_seconds_count{service="${service}"}[1m]))`;
    const errorRatioQuery = `100 * (sum(rate(http_server_duration_milliseconds_count{service_name="${service}",http_status_code=~"5.."}[1m])) or sum(rate(http_request_duration_seconds_count{service="${service}",status=~"5.."}[1m])) or vector(0)) / clamp_min(sum(rate(http_server_duration_milliseconds_count{service_name="${service}"}[1m])) or sum(rate(http_request_duration_seconds_count{service="${service}"}[1m])), 1)`;
    const p95Query = `(histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket{service_name="${service}"}[1m])) by (le))) or (1000 * histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${service}"}[1m])) by (le)))`;

    try {
      const [rpsOut, errorOut, p95Out] = await Promise.all([
        this.toolsPort.executePromqlRange({
          query: rpsQuery,
          start: startIso,
          end: endIso,
          step: '30s'
        }),
        this.toolsPort.executePromqlRange({
          query: errorRatioQuery,
          start: startIso,
          end: endIso,
          step: '30s'
        }),
        this.toolsPort.executePromqlRange({
          query: p95Query,
          start: startIso,
          end: endIso,
          step: '30s'
        })
      ]);

      const requestsPerSecond = round(extractMetricSample(rpsOut), 2);
      const errorRate5xxPercent = Math.min(100, round(extractMetricSample(errorOut), 2));
      const p95LatencyMs = round(extractMetricSample(p95Out), 2);
      const isDegraded = errorRate5xxPercent > errorThreshold;

      return {
        status: isDegraded ? TargetHealthStatus.DEGRADED : TargetHealthStatus.HEALTHY,
        service,
        version,
        previousHealthyVersion,
        targetRepo,
        suspectFilePath,
        capabilities: {
          chaosSimulation: false,
          healthyTrafficToggle: false
        },
        rawEdgeLogPreCollector: '',
        metrics: {
          requestsPerSecond,
          errorRate5xxPercent,
          p95LatencyMs,
          healthyTrafficActive: false
        }
      };
    } catch {
      return {
        status: TargetHealthStatus.UNREACHABLE,
        service,
        version,
        previousHealthyVersion,
        targetRepo,
        suspectFilePath,
        capabilities: {
          chaosSimulation: false,
          healthyTrafficToggle: false
        },
        rawEdgeLogPreCollector: ''
      };
    }
  }
}

/**
 * Selects the configured `TargetStatusPort` provider (`manifest` or `prometheus`).
 */
export function createTargetStatusPort(toolsPort: ToolsPort): TargetStatusPort {
  const provider = (process.env.TARGET_STATUS_PROVIDER || 'manifest').trim().toLowerCase();
  if (provider === 'prometheus') {
    return new PrometheusTargetStatusAdapter(toolsPort);
  }
  return new HttpTargetStatusAdapter();
}
