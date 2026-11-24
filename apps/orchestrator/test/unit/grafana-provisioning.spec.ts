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
  'infra/grafana/provisioning/dashboards/zeromttr-api-pagamentos-core.json'
);

describe('Grafana dashboard provisioning', () => {
  it('should_provision_valid_zeromttr_grafana_dashboard_referencing_prometheus_and_incident_annotations', () => {
    expect(fs.existsSync(DASHBOARD_PROVISIONING_YAML)).toBe(true);
    const yamlContent = fs.readFileSync(DASHBOARD_PROVISIONING_YAML, 'utf8');
    expect(yamlContent).toContain('/etc/grafana/provisioning/dashboards');

    expect(fs.existsSync(GRAFANA_DASHBOARD_JSON)).toBe(true);
    const dashboard = JSON.parse(fs.readFileSync(GRAFANA_DASHBOARD_JSON, 'utf8')) as {
      title: string;
      uid: string;
      annotations?: { list?: Array<{ name: string; tags?: string[] }> };
      panels?: Array<{
        title: string;
        type: string;
        targets?: Array<{ datasource?: { uid?: string }; expr?: string }>;
      }>;
    };

    expect(dashboard.uid).toBe('zeromttr-payment-core');
    expect(dashboard.title).toContain('api-pagamentos-core');
    expect(dashboard.panels && dashboard.panels.length).toBeGreaterThanOrEqual(6);

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
    expect(allExprs).toContain('db_pool_used');
    expect(allExprs).toContain('db_pool_waiting');

    const annotationTags = dashboard.annotations?.list?.flatMap((a) => a.tags ?? []) ?? [];
    expect(annotationTags).toContain('zeromttr');
  });
});
