import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { clamp, isFilled, percentage } from '@zeromttr/utils';
import { Knob } from 'primeng/knob';
import { MeterGroup, type MeterItem } from 'primeng/metergroup';
import { ProgressBar } from 'primeng/progressbar';
import { Tag } from 'primeng/tag';
import { TARGET_TELEMETRY_THRESHOLDS, TelemetryHealthLevel } from '../../core/constants.js';
import type { TargetLiveMetrics, TargetSaturation } from '../../core/contract.js';
import { I18nService } from '../../core/i18n/i18n.service.js';

/**
 * Displays compact instantaneous target workload telemetry cards (throughput, 5xx rate, p95 latency, and generic saturation).
 */
@Component({
  selector: 'app-target-telemetry',
  imports: [CommonModule, FormsModule, Tag, ProgressBar, Knob, MeterGroup],
  templateUrl: './target-telemetry.component.html',
  styleUrl: './target-telemetry.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TargetTelemetryComponent {
  readonly i18n = inject(I18nService);
  readonly healthLevel = TelemetryHealthLevel;

  readonly metricsSignal = signal<TargetLiveMetrics | null>(null);
  readonly serviceNameSignal = signal<string>('');

  @Input()
  set metrics(value: TargetLiveMetrics | null) {
    this.metricsSignal.set(value);
  }

  @Input()
  set serviceName(value: string) {
    this.serviceNameSignal.set(value);
  }

  readonly saturationSignal = computed<TargetSaturation | null>(() => {
    const current = this.metricsSignal();
    if (!current) {
      return null;
    }
    if (current.saturation) {
      return current.saturation;
    }
    if ([current.poolActive, current.poolWaiting, current.poolMax].some(isFilled)) {
      return {
        resourceLabel: this.i18n.t('targetPoolLabel'),
        active: current.poolActive ?? 0,
        waiting: current.poolWaiting ?? 0,
        max: current.poolMax ?? 0
      };
    }
    return null;
  });

  readonly throughputPercent = computed<number>(() => {
    const rps = this.metricsSignal()?.requestsPerSecond ?? 0;
    return clamp(percentage(rps, TARGET_TELEMETRY_THRESHOLDS.THROUGHPUT_SCALE_MAX_RPS, 0), 0, 100);
  });

  readonly latencyPercent = computed<number>(() => {
    const p95 = this.metricsSignal()?.p95LatencyMs ?? 0;
    return clamp(percentage(p95, TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_SCALE_MAX_MS, 0), 0, 100);
  });

  readonly throughputLevel = computed<TelemetryHealthLevel>(() => {
    const current = this.metricsSignal();
    if (!current || !current.healthyTrafficActive) {
      return TelemetryHealthLevel.HEALTHY;
    }
    if (current.requestsPerSecond < TARGET_TELEMETRY_THRESHOLDS.THROUGHPUT_WARN_MIN_RPS) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly error5xxLevel = computed<TelemetryHealthLevel>(() => {
    const err = this.metricsSignal()?.errorRate5xxPercent ?? 0;
    if (err >= TARGET_TELEMETRY_THRESHOLDS.ERROR_5XX_CRITICAL_PERCENT) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (err >= TARGET_TELEMETRY_THRESHOLDS.ERROR_5XX_WARN_PERCENT) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly latencyLevel = computed<TelemetryHealthLevel>(() => {
    const p95 = this.metricsSignal()?.p95LatencyMs ?? 0;
    if (p95 >= TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_CRITICAL_MS) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (p95 >= TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_WARN_MS) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly poolLevel = computed<TelemetryHealthLevel>(() => {
    const sat = this.saturationSignal();
    if (!sat) {
      return TelemetryHealthLevel.HEALTHY;
    }
    if (sat.waiting > 0) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (sat.max <= 0) {
      return TelemetryHealthLevel.HEALTHY;
    }
    const ratio = sat.active / sat.max;
    if (ratio >= TARGET_TELEMETRY_THRESHOLDS.POOL_USAGE_CRITICAL_RATIO) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (ratio >= TARGET_TELEMETRY_THRESHOLDS.POOL_USAGE_WARN_RATIO) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly error5xxColor = computed<string>(() => {
    const level = this.error5xxLevel();
    if (level === TelemetryHealthLevel.CRITICAL) {
      return '#f43f5e';
    }
    if (level === TelemetryHealthLevel.WARN) {
      return '#f59e0b';
    }
    return '#10b981';
  });

  readonly poolMax = computed<number>(() => {
    const sat = this.saturationSignal();
    if (!sat) {
      return 10;
    }
    return Math.max(1, sat.max, sat.active + sat.waiting);
  });

  readonly poolMeters = computed<MeterItem[]>(() => {
    const sat = this.saturationSignal();
    if (!sat) {
      return [];
    }
    const level = this.poolLevel();
    const activeColor =
      level === TelemetryHealthLevel.CRITICAL
        ? '#f43f5e'
        : level === TelemetryHealthLevel.WARN
          ? '#f59e0b'
          : '#10b981';
    const items: MeterItem[] = [
      {
        label: `${this.i18n.t('targetPoolActiveLabel')} (${sat.active})`,
        value: sat.active,
        color: activeColor
      }
    ];
    if (sat.waiting > 0) {
      items.push({
        label: `${this.i18n.t('targetPoolWaitingLabel')} (${sat.waiting})`,
        value: sat.waiting,
        color: '#f59e0b'
      });
    }
    return items;
  });
}
