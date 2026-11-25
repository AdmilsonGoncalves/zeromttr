import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { LiveMetricsTabComponent } from '../src/app/war-room/evidence-panel/live-metrics-tab/live-metrics-tab.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_METRICS_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/evidence-panel/live-metrics-tab/live-metrics-tab.component.html'
);

describe('LiveMetricsTabComponent', () => {
  let i18n: I18nService;
  let component: LiveMetricsTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new LiveMetricsTabComponent(i18n);
  });

  it('should_compute_live_time_series_geometries_from_telemetry_history', () => {
    component.telemetryHistory = [
      {
        timestampMs: 1000,
        label: '11:00:00',
        requestsPerSecond: 1.4,
        errorRate5xxPercent: 0,
        p95LatencyMs: 18,
        poolActive: 1,
        poolWaiting: 0,
        poolMax: 10,
        healthyTrafficActive: true
      },
      {
        timestampMs: 3000,
        label: '11:00:02',
        requestsPerSecond: 4.2,
        errorRate5xxPercent: 100,
        p95LatencyMs: 1500,
        poolActive: 2,
        poolWaiting: 3,
        poolMax: 2,
        healthyTrafficActive: true
      }
    ];

    expect(component.latencyTimeSeries().points).toHaveLength(2);
    expect(component.errorTimeSeries().points).toHaveLength(2);
    expect(component.throughputTimeSeries().points).toHaveLength(2);
    expect(component.poolTimeSeries().points).toHaveLength(2);
  });

  it('should_return_empty_series_when_no_history_is_loaded', () => {
    expect(component.latencyTimeSeries().points).toEqual([]);
    expect(component.throughputTimeSeries().points).toEqual([]);
  });

  it('should_render_only_dedicated_time_series_without_duplicate_gauges_or_finops_mttr_cards', () => {
    const html = readFileSync(LIVE_METRICS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('chartLatencyErrorTitle');
    expect(html).toContain('chartThroughputPoolTitle');
    expect(html).not.toContain('chartPoolGaugeLabel');
    expect(html).not.toContain('chartFinopsGaugeLabel');
    expect(html).not.toContain('chartMttrBarsTitle');
    expect(html).not.toContain('chartFinopsBarsTitle');
  });
});
