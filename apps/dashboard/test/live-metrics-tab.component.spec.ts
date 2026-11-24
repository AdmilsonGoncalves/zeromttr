import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { LiveMetricsTabComponent } from '../src/app/war-room/evidence-panel/live-metrics-tab/live-metrics-tab.component.js';

describe('LiveMetricsTabComponent', () => {
  let i18n: I18nService;
  let component: LiveMetricsTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new LiveMetricsTabComponent(i18n);
    component.finopsReduction = 84;
  });

  it('should_compute_live_charts_gauges_and_finops_bars_from_telemetry_history', () => {
    component.incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
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
    expect(component.poolUsageGauge().clampedPercent).toBe(100);
    expect(component.poolUsageColor()).toBe('#f43f5e');
    expect(component.finopsGauge().clampedPercent).toBe(84);
    expect(component.finopsSavingsBarPercent()).toBeGreaterThan(0);
    expect(component.mttrComparisonBars().ttprPercentOfManual).toBeLessThan(10);
  });

  it('should_use_healthy_defaults_when_no_incident_or_history_is_loaded', () => {
    expect(component.latencyTimeSeries().points).toEqual([]);
    expect(component.poolUsageGauge().clampedPercent).toBe(0);
    expect(component.poolUsageColor()).toBe('#10b981');
    expect(component.mttrComparisonBars().manualSeconds).toBe(1800);
  });
});
