import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { diffInSeconds, round } from '@zeromttr/utils';
import { TARGET_TELEMETRY_THRESHOLDS } from '../../../core/constants.js';
import type { IncidentDetail, TargetStatusResponse } from '../../../core/contract.js';
import type { TelemetryHistoryPoint } from '../../../core/incident.service.js';
import { I18nService } from '../../../core/i18n.service.js';
import {
  buildGaugeArcGeometry,
  buildTimeSeriesGeometry,
  type GaugeArcGeometry,
  type TimeSeriesGeometry
} from '../../../core/telemetry-chart.utils.js';

/**
 * Displays Grafana-style live telemetry time series, threshold gauges, and FinOps/MTTR comparison bars.
 */
@Component({
  selector: 'app-live-metrics-tab',
  imports: [],
  templateUrl: './live-metrics-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveMetricsTabComponent {
  readonly i18n: I18nService;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly telemetryHistorySignal = signal<TelemetryHistoryPoint[]>([]);
  readonly finopsReductionSignal = signal<number>(0);

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input()
  set targetStatus(value: TargetStatusResponse | null) {
    this.targetStatusSignal.set(value);
  }

  @Input()
  set telemetryHistory(value: TelemetryHistoryPoint[]) {
    this.telemetryHistorySignal.set(value);
  }

  @Input({ required: true })
  set finopsReduction(value: number) {
    this.finopsReductionSignal.set(value);
  }

  readonly latencyTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.p95LatencyMs
      })),
      380,
      110,
      { min: 0, unit: 'ms' }
    )
  );

  readonly errorTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.errorRate5xxPercent
      })),
      380,
      110,
      { min: 0, max: 100, unit: '%' }
    )
  );

  readonly throughputTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.requestsPerSecond
      })),
      380,
      110,
      { min: 0, unit: ' rps' }
    )
  );

  readonly poolTimeSeries = computed<TimeSeriesGeometry>(() =>
    buildTimeSeriesGeometry(
      this.telemetryHistorySignal().map((pt) => ({
        label: pt.label,
        value: pt.poolActive + pt.poolWaiting
      })),
      380,
      110,
      { min: 0 }
    )
  );

  readonly poolUsageGauge = computed<GaugeArcGeometry>(() => {
    const history = this.telemetryHistorySignal();
    const latest = history[history.length - 1];
    const metrics = this.targetStatusSignal()?.metrics;
    const poolActive = metrics?.poolActive ?? latest?.poolActive ?? 0;
    const poolWaiting = metrics?.poolWaiting ?? latest?.poolWaiting ?? 0;
    const poolMax = metrics?.poolMax ?? latest?.poolMax ?? 10;
    const ratioPercent = poolMax > 0 ? ((poolActive + poolWaiting) / poolMax) * 100 : 0;
    return buildGaugeArcGeometry(ratioPercent);
  });

  readonly poolUsageColor = computed<string>(() => {
    const pct = this.poolUsageGauge().clampedPercent;
    if (pct >= TARGET_TELEMETRY_THRESHOLDS.POOL_USAGE_CRITICAL_RATIO * 100) {
      return '#f43f5e';
    }
    if (pct >= TARGET_TELEMETRY_THRESHOLDS.POOL_USAGE_WARN_RATIO * 100) {
      return '#f59e0b';
    }
    return '#10b981';
  });

  readonly finopsGauge = computed<GaugeArcGeometry>(() =>
    buildGaugeArcGeometry(this.finopsReductionSignal())
  );

  readonly finopsSavingsBarPercent = computed<number>(() => {
    const finops = this.incidentSignal()?.finops;
    const raw = finops?.rawBytesFetched ?? 48200;
    const compacted = finops?.compactedBytesSent ?? 7712;
    if (raw <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(2, round((compacted / raw) * 100, 1)));
  });

  readonly mttrComparisonBars = computed(() => {
    const inc = this.incidentSignal();
    const ttdSeconds = inc?.rca?.diagnosisSeconds ?? 4.2;
    let ttprSeconds = 18;
    const prTransition = inc?.transitions.find((t) => t.to === 'AWAITING_PR');
    if (inc?.startedAt && prTransition?.at) {
      ttprSeconds = Math.max(1, round(diffInSeconds(inc.startedAt, prTransition.at), 1));
    }
    const manualSeconds = 1800;
    return {
      ttdSeconds,
      ttprSeconds,
      manualSeconds,
      ttdPercentOfManual: Math.min(100, Math.max(2, round((ttdSeconds / manualSeconds) * 100, 1))),
      ttprPercentOfManual: Math.min(100, Math.max(3, round((ttprSeconds / manualSeconds) * 100, 1)))
    };
  });

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }
}
