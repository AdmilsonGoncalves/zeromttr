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
    expect(component.latestLatencyMs()).toBe(1500);
    expect(component.latestErrorPercent()).toBe(100);
    expect(component.latestRequestsPerSecond()).toBe(4.2);
    expect(component.latestPoolConnections()).toBe(5);
  });

  it('should_return_empty_series_and_zero_latest_metrics_when_no_history_is_loaded', () => {
    expect(component.latencyTimeSeries().points).toEqual([]);
    expect(component.throughputTimeSeries().points).toEqual([]);
    expect(component.latestLatencyMs()).toBe(0);
    expect(component.latestErrorPercent()).toBe(0);
    expect(component.latestRequestsPerSecond()).toBe(0);
    expect(component.latestPoolConnections()).toBe(0);
  });

  it('should render only dedicated time series with secondary axis labels and no duplicate gauges', () => {
    const html = readFileSync(LIVE_METRICS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('chartLatencyErrorTitle');
    expect(html).toContain('throughputChartTitle()');
    expect(html).toContain('@if (hasSaturationSeries())');
    expect(html).toContain('latestLatencyMs()');
    expect(html).toContain('latestPoolConnections()');
    expect(html).toContain('errorTimeSeries().yTicks');
    expect(html).toContain('poolTimeSeries().yTicks');
    expect(html).not.toContain('Pool Conn');
    expect(html).not.toContain(' conn');
    expect(html).not.toContain('chartPoolGaugeLabel');
    expect(html).not.toContain('chartFinopsGaugeLabel');
    expect(html).not.toContain('chartMttrBarsTitle');
    expect(html).not.toContain('chartFinopsBarsTitle');
    expect(html).not.toContain('tick.y + 9');
    expect(html).toContain('yTickLabelY(tick.y)');
  });

  it('should hide secondary saturation series and show neutral throughput title when target has no saturation', () => {
    component.telemetryHistory = [
      {
        timestampMs: 1000,
        label: '11:00:00',
        requestsPerSecond: 12.5,
        errorRate5xxPercent: 0,
        p95LatencyMs: 24,
        poolActive: 0,
        poolWaiting: 0,
        poolMax: 0,
        healthyTrafficActive: false
      }
    ];

    expect(component.hasSaturationSeries()).toBe(false);
    expect(component.saturationResourceLabel()).toBeNull();
    expect(component.throughputChartTitle()).toBe('Vazão (req/s)');
  });

  it('should render custom saturation resource label on throughput chart from telemetry history', () => {
    component.telemetryHistory = [
      {
        timestampMs: 1000,
        label: '11:00:00',
        requestsPerSecond: 19,
        errorRate5xxPercent: 0,
        p95LatencyMs: 32,
        poolActive: 5,
        poolWaiting: 1,
        poolMax: 16,
        saturationResourceLabel: 'Worker Queue',
        healthyTrafficActive: false
      }
    ];

    expect(component.hasSaturationSeries()).toBe(true);
    expect(component.saturationResourceLabel()).toBe('Worker Queue');
    expect(component.throughputChartTitle()).toBe('Vazão (req/s) & Worker Queue');
  });

  it('should_keep_all_svg_y_tick_labels_inside_the_145px_viewbox_bounds', () => {
    const labelYFn = (component as unknown as { yTickLabelY?: (tickY: number) => number })
      .yTickLabelY;
    expect(typeof labelYFn).toBe('function');

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
      }
    ];

    for (const tick of component.latencyTimeSeries().yTicks) {
      const y = labelYFn!(tick.y);
      expect(y).toBeGreaterThanOrEqual(9);
      expect(y).toBeLessThanOrEqual(142);
    }
  });
});
