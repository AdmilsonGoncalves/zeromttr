import { getMcpDomainStatus } from '../domain/index.js';

export * from './validate-time-range.js';
export * from './execute-promql-range.js';
export * from './query-loki-logs.js';
export * from './analyze-otel-trace.js';
export * from './search-traces-by-traceql.js';
export * from './inspect-git-deploy-diff.js';
export * from './create-remediation-pr.js';
export * from './send-post-mortem-resend.js';
export * from './annotate-grafana-incident.js';

export function checkMcpApplicationHealth(): { healthy: boolean; status: string } {
  const domainStatus = getMcpDomainStatus();
  return {
    healthy: domainStatus.status === 'ready',
    status: domainStatus.status
  };
}
