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

  it('should return healthy defaults when metrics signal is null', () => {
    component.metrics = null;
    expect(component.throughputPercent()).toBe(0);
    expect(component.latencyPercent()).toBe(0);
    expect(component.throughputLevel()).toBe(TelemetryHealthLevel.HEALTHY);
    expect(component.error5xxLevel()).toBe(TelemetryHealthLevel.HEALTHY);
    expect(component.error5xxColor()).toBe('#10b981');
    expect(component.poolMax()).toBe(10);
    expect(component.poolMeters()).toEqual([]);
  });

  it('should compute critical levels, colors and pool meters when workload is saturated', () => {
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

  it('should compute warning levels and amber color when thresholds are in warn range', () => {
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
});
