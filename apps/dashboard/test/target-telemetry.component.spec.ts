import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { TelemetryHealthLevel } from '../src/app/core/constants.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { TargetTelemetryComponent } from '../src/app/war-room/target-telemetry/target-telemetry.component.js';

describe('TargetTelemetryComponent', () => {
  let i18n: I18nService;
  let component: TargetTelemetryComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new TargetTelemetryComponent(i18n);
  });

  it('should_return_healthy_defaults_when_metrics_signal_is_null', () => {
    component.metrics = null;
    expect(component.throughputPercent()).toBe(0);
    expect(component.latencyPercent()).toBe(0);
    expect(component.throughputLevel()).toBe(TelemetryHealthLevel.HEALTHY);
    expect(component.error5xxLevel()).toBe(TelemetryHealthLevel.HEALTHY);
    expect(component.error5xxColor()).toBe('#10b981');
    expect(component.poolMax()).toBe(10);
    expect(component.poolMeters()).toEqual([]);
  });

  it('should_compute_critical_levels_colors_and_pool_meters_when_workload_is_saturated', () => {
    component.metrics = {
      healthyTrafficActive: true,
      requestsPerSecond: 12,
      errorRate5xxPercent: 85,
      p95LatencyMs: 2400,
      poolActive: 10,
      poolMax: 10,
      poolWaiting: 4
    };

    expect(component.error5xxLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(component.error5xxColor()).toBe('#f43f5e');
    expect(component.latencyLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(component.poolLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(component.poolMax()).toBe(14);
    expect(component.poolMeters()).toHaveLength(2);
  });

  it('should_compute_warning_levels_and_amber_color_when_thresholds_are_in_warn_range', () => {
    component.metrics = {
      healthyTrafficActive: true,
      requestsPerSecond: 0.2,
      errorRate5xxPercent: 1,
      p95LatencyMs: 300,
      poolActive: 7,
      poolMax: 10,
      poolWaiting: 0
    };

    expect(component.throughputLevel()).toBe(TelemetryHealthLevel.WARN);
    expect(component.error5xxLevel()).toBe(TelemetryHealthLevel.WARN);
    expect(component.error5xxColor()).toBe('#f59e0b');
    expect(component.latencyLevel()).toBe(TelemetryHealthLevel.WARN);
    expect(component.poolLevel()).toBe(TelemetryHealthLevel.WARN);
    expect(component.poolMeters()).toHaveLength(1);
  });

  it('should_compute_card_sparkline_paths_from_telemetry_history', () => {
    component.history = [
      {
        timestampMs: 1000,
        label: '11:00:00',
        requestsPerSecond: 1.5,
        errorRate5xxPercent: 0,
        p95LatencyMs: 20,
        poolActive: 1,
        poolWaiting: 0,
        poolMax: 10,
        healthyTrafficActive: true
      },
      {
        timestampMs: 3000,
        label: '11:00:02',
        requestsPerSecond: 3.2,
        errorRate5xxPercent: 80,
        p95LatencyMs: 1400,
        poolActive: 2,
        poolWaiting: 4,
        poolMax: 2,
        healthyTrafficActive: true
      }
    ];

    expect(component.rpsSparkline().linePath).toContain('M ');
    expect(component.error5xxSparkline().linePath).toContain('M ');
    expect(component.latencySparkline().linePath).toContain('M ');
    expect(component.poolSparkline().linePath).toContain('M ');
  });
});
