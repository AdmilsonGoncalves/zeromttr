import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Knob } from 'primeng/knob';
import { MeterGroup, type MeterItem } from 'primeng/metergroup';
import { ProgressBar } from 'primeng/progressbar';
import { Tag } from 'primeng/tag';
import { TARGET_TELEMETRY_THRESHOLDS, TelemetryHealthLevel } from '../../core/constants.js';
import type { TargetLiveMetrics } from '../../core/contract.js';
import { I18nService } from '../../core/i18n.service.js';

/**
 * Displays live target workload telemetry cards (throughput, 5xx rate, p95 latency, and DB pool usage).
 */
@Component({
  selector: 'app-target-telemetry',
  imports: [CommonModule, FormsModule, Tag, ProgressBar, Knob, MeterGroup],
  templateUrl: './target-telemetry.component.html',
  styleUrl: './target-telemetry.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TargetTelemetryComponent {
  readonly i18n: I18nService;

  readonly metrics = input<TargetLiveMetrics | null>(null);

  readonly throughputPercent = computed<number>(() => {
    const rps = this.metrics()?.requestsPerSecond ?? 0;
    return Math.min(
      100,
      Math.round((rps / TARGET_TELEMETRY_THRESHOLDS.THROUGHPUT_SCALE_MAX_RPS) * 100)
    );
  });

  readonly latencyPercent = computed<number>(() => {
    const p95 = this.metrics()?.p95LatencyMs ?? 0;
    return Math.min(
      100,
      Math.round((p95 / TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_SCALE_MAX_MS) * 100)
    );
  });

  readonly throughputLevel = computed<TelemetryHealthLevel>(() => {
    const current = this.metrics();
    if (!current || !current.healthyTrafficActive) {
      return TelemetryHealthLevel.HEALTHY;
    }
    if (current.requestsPerSecond < TARGET_TELEMETRY_THRESHOLDS.THROUGHPUT_WARN_MIN_RPS) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly error5xxLevel = computed<TelemetryHealthLevel>(() => {
    const err = this.metrics()?.errorRate5xxPercent ?? 0;
    if (err >= TARGET_TELEMETRY_THRESHOLDS.ERROR_5XX_CRITICAL_PERCENT) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (err >= TARGET_TELEMETRY_THRESHOLDS.ERROR_5XX_WARN_PERCENT) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly latencyLevel = computed<TelemetryHealthLevel>(() => {
    const p95 = this.metrics()?.p95LatencyMs ?? 0;
    if (p95 >= TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_CRITICAL_MS) {
      return TelemetryHealthLevel.CRITICAL;
    }
    if (p95 >= TARGET_TELEMETRY_THRESHOLDS.LATENCY_P95_WARN_MS) {
      return TelemetryHealthLevel.WARN;
    }
    return TelemetryHealthLevel.HEALTHY;
  });

  readonly poolLevel = computed<TelemetryHealthLevel>(() => {
    const current = this.metrics();
    if (!current || current.poolMax <= 0) {
      return TelemetryHealthLevel.HEALTHY;
    }
    const ratio = current.poolActive / current.poolMax;
    if (current.poolWaiting > 0 || ratio >= TARGET_TELEMETRY_THRESHOLDS.POOL_USAGE_CRITICAL_RATIO) {
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
    const current = this.metrics();
    if (!current) {
      return 10;
    }
    return Math.max(1, current.poolMax, current.poolActive + current.poolWaiting);
  });

  readonly poolMeters = computed<MeterItem[]>(() => {
    const current = this.metrics();
    if (!current) {
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
        label: `${this.i18n.t('targetPoolActiveLabel')} (${current.poolActive})`,
        value: current.poolActive,
        color: activeColor
      }
    ];
    if (current.poolWaiting > 0) {
      items.push({
        label: `${this.i18n.t('targetPoolWaitingLabel')} (${current.poolWaiting})`,
        value: current.poolWaiting,
        color: '#f59e0b'
      });
    }
    return items;
  });

  constructor(i18n?: I18nService) {
    this.i18n = i18n ?? inject(I18nService);
  }
}
