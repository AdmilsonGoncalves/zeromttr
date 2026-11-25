import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import type { TelemetryHistoryPoint } from '../../../core/incident.service.js';
import { I18nService } from '../../../core/i18n/i18n.service.js';
import {
  buildTimeSeriesGeometry,
  type TimeSeriesGeometry
} from '../../../core/telemetry-chart.utils.js';

/**
 * Displays dedicated Grafana-style live telemetry time series inside the Evidence Panel without duplicating KPI cards.
 */
@Component({
  selector: 'app-live-metrics-tab',
  imports: [],
  templateUrl: './live-metrics-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveMetricsTabComponent {
  readonly i18n: I18nService;

  readonly telemetryHistorySignal = signal<TelemetryHistoryPoint[]>([]);

  @Input()
  set telemetryHistory(value: TelemetryHistoryPoint[]) {
    this.telemetryHistorySignal.set(value);
  }

  readonly latencyTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.p95LatencyMs
      })),
      420,
      145,
      { min: 0, unit: 'ms' }
    )
  );

  readonly errorTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.errorRate5xxPercent
      })),
      420,
      145,
      { min: 0, max: 100, unit: '%' }
    )
  );

  readonly throughputTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.requestsPerSecond
      })),
      420,
      145,
      { min: 0, unit: ' rps' }
    )
  );

  readonly poolTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.poolActive + pt.poolWaiting
      })),
      420,
      145,
      { min: 0 }
    )
  );

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }
}
