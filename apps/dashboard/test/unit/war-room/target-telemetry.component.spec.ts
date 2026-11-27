import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { TelemetryHealthLevel } from '../../../src/app/core/constants.js';
import { I18nService } from '../../../src/app/core/i18n/i18n.service.js';
import { TargetTelemetryComponent } from '../../../src/app/war-room/target-telemetry/target-telemetry.component.js';
import { createWithInjector } from '../../helpers/di.helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TELEMETRY_TEMPLATE_PATH = resolve(
  HERE,
  '../../../src/app/war-room/target-telemetry/target-telemetry.component.html'
);

describe('TargetTelemetryComponent', () => {
  let i18n: I18nService;
  let component: TargetTelemetryComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = createWithInjector(TargetTelemetryComponent, [
      { provide: I18nService, useValue: i18n }
    ]);
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

  it('should_render_compact_instantaneous_cards_without_duplicate_card_sparklines', () => {
    const html = readFileSync(TELEMETRY_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('rpsSparkline');
    expect(html).not.toContain('error5xxSparkline');
    expect(html).not.toContain('latencySparkline');
    expect(html).not.toContain('poolSparkline');
    expect(html).toContain('<p-progressbar');
    expect(html).toContain('<p-knob');
    expect(html).toContain('<p-metergroup');
  });

  it('should render dynamic service name from input instead of hardcoded demo name', () => {
    const html = readFileSync(TELEMETRY_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('api-pagamentos-core');

    component.serviceName = 'expedicao-frete-worker';
    expect(component.serviceNameSignal()).toBe('expedicao-frete-worker');
  });

  it('should render custom saturation resource label from api', () => {
    component.metrics = {
      healthyTrafficActive: false,
      requestsPerSecond: 18,
      errorRate5xxPercent: 0,
      p95LatencyMs: 64,
      saturation: {
        resourceLabel: 'Worker Queue',
        active: 6,
        waiting: 2,
        max: 10
      }
    };

    expect(component.saturationSignal()).toEqual({
      resourceLabel: 'Worker Queue',
      active: 6,
      waiting: 2,
      max: 10
    });
    expect(component.poolLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(component.poolMax()).toBe(10);
    expect(component.poolMeters()).toHaveLength(2);
  });

  it('should hide saturation card cleanly when target does not report saturation', () => {
    component.metrics = {
      healthyTrafficActive: false,
      requestsPerSecond: 45,
      errorRate5xxPercent: 0,
      p95LatencyMs: 92
    };

    expect(component.saturationSignal()).toBeNull();
    expect(component.poolMeters()).toEqual([]);

    const html = readFileSync(TELEMETRY_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('@if (saturationSignal(); as sat)');
  });

  it('should_report_critical_poolLevel_when_waiting_is_positive_even_with_zero_max_capacity', () => {
    component.metrics = {
      healthyTrafficActive: false,
      requestsPerSecond: 10,
      errorRate5xxPercent: 0,
      p95LatencyMs: 80,
      saturation: {
        resourceLabel: 'Worker Queue',
        active: 0,
        waiting: 3,
        max: 0
      }
    };
    expect(component.poolLevel()).toBe(TelemetryHealthLevel.CRITICAL);

    component.metrics = {
      healthyTrafficActive: false,
      requestsPerSecond: 10,
      errorRate5xxPercent: 0,
      p95LatencyMs: 80,
      saturation: {
        resourceLabel: 'Worker Queue',
        active: 0,
        waiting: 0,
        max: 0
      }
    };
    expect(component.poolLevel()).toBe(TelemetryHealthLevel.HEALTHY);
  });
});
