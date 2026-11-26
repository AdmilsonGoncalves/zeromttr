import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../');
const DASHBOARD_PROVISIONING_YAML = path.join(
  REPO_ROOT,
  'infra/grafana/provisioning/dashboards/dashboards.yaml'
);
const GRAFANA_DASHBOARD_JSON = path.join(
  REPO_ROOT,
  'infra/grafana/provisioning/dashboards/zeromttr-target-workload.json'
);
const LEGACY_GRAFANA_DASHBOARD_JSON = path.join(
  REPO_ROOT,
  'infra/grafana/provisioning/dashboards/zeromttr-api-pagamentos-core.json'
);

describe('Grafana dashboard provisioning', () => {
  it('should provision valid agnostic zeromttr grafana dashboard with service template variable', () => {
    expect(fs.existsSync(DASHBOARD_PROVISIONING_YAML)).toBe(true);
    const yamlContent = fs.readFileSync(DASHBOARD_PROVISIONING_YAML, 'utf8');
    expect(yamlContent).toContain('/etc/grafana/provisioning/dashboards');

    expect(fs.existsSync(LEGACY_GRAFANA_DASHBOARD_JSON)).toBe(false);
    expect(fs.existsSync(GRAFANA_DASHBOARD_JSON)).toBe(true);
    const rawDashboard = fs.readFileSync(GRAFANA_DASHBOARD_JSON, 'utf8');
    expect(rawDashboard).not.toContain('api-pagamentos-core');

    const dashboard = JSON.parse(rawDashboard) as {
      title: string;
      uid: string;
      templating?: {
        list?: Array<{ name: string; query?: string | { query?: string } }>;
      };
      annotations?: { list?: Array<{ name: string; tags?: string[] }> };
      panels?: Array<{
        title: string;
        type: string;
        targets?: Array<{ datasource?: { uid?: string }; expr?: string }>;
      }>;
    };

    expect(dashboard.uid).toBe('zeromttr-target-workload');
    expect(dashboard.title).toBe('ZeroMTTR — $service Performance & Remediation');
    expect(dashboard.panels && dashboard.panels.length).toBeGreaterThanOrEqual(6);

    const serviceVar = dashboard.templating?.list?.find((v) => v.name === 'service');
    expect(serviceVar).toBeDefined();
    const serviceQuery =
      typeof serviceVar?.query === 'string' ? serviceVar.query : (serviceVar?.query?.query ?? '');
    expect(serviceQuery).toContain('label_values(http_request_duration_seconds_count, service)');

    const panelTitles = dashboard.panels?.map((p) => p.title) ?? [];
    expect(panelTitles).toContain('HTTP Throughput (req/s)');

    const panelTypes = new Set(dashboard.panels?.map((p) => p.type));
    expect(panelTypes.has('timeseries')).toBe(true);
    expect(panelTypes.has('gauge')).toBe(true);
    expect(panelTypes.has('stat')).toBe(true);

    const allExprs =
      dashboard.panels
        ?.flatMap((p) => p.targets ?? [])
        .map((t) => `${t.datasource?.uid ?? ''}:${t.expr ?? ''}`)
        .join('\n') ?? '';

    expect(allExprs).toContain('prometheus-datasource');
    expect(allExprs).toContain('http_request_duration_seconds_bucket');
    expect(allExprs).toContain('{service="$service"');
    expect(allExprs).toContain('db_pool_used');
    expect(allExprs).toContain('db_pool_waiting');

    const annotationTags = dashboard.annotations?.list?.flatMap((a) => a.tags ?? []) ?? [];
    expect(annotationTags).toContain('zeromttr');
  });

  it('should_interpolate_GRAFANA_ALERT_REPEAT_INTERVAL_in_alerting_policies_yaml', () => {
    const policiesPath = path.join(REPO_ROOT, 'infra/grafana/provisioning/alerting/policies.yaml');
    const policiesYaml = fs.readFileSync(policiesPath, 'utf8');
    expect(policiesYaml).toContain('repeat_interval: ${GRAFANA_ALERT_REPEAT_INTERVAL}');
  });
});
