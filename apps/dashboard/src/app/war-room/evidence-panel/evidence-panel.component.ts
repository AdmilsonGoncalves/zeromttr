import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { isFilled } from '@zeromttr/utils';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import type { IncidentDetail, TargetStatusResponse } from '../../core/contract.js';
import type { TelemetryHistoryPoint } from '../../core/incident.service.js';
import { I18nService } from '../../core/i18n/i18n.service.js';
import { GitDiffFinopsTabComponent } from './git-diff-finops-tab/git-diff-finops-tab.component.js';
import { LiveMetricsTabComponent } from './live-metrics-tab/live-metrics-tab.component.js';
import { LokiPiiTabComponent } from './loki-pii-tab/loki-pii-tab.component.js';
import { TraceTreeTabComponent } from './trace-tree-tab/trace-tree-tab.component.js';

/**
 * Center War Room quadrant composing tabbed evidence views: Live Metrics, Trace Tree, Loki PII, and Git Diff/FinOps.
 */
@Component({
  selector: 'app-evidence-panel',
  imports: [
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    LiveMetricsTabComponent,
    TraceTreeTabComponent,
    LokiPiiTabComponent,
    GitDiffFinopsTabComponent
  ],
  templateUrl: './evidence-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EvidencePanelComponent {
  readonly i18n = inject(I18nService);

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly telemetryHistorySignal = signal<TelemetryHistoryPoint[]>([]);
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);
  readonly isPiiPassedSignal = signal<boolean | null>(null);
  readonly leakedPatternsCountSignal = signal<number>(0);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);
  readonly activeTab = signal<string>('0');

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
  set signalsRatio(value: string) {
    this.signalsRatioSignal.set(value);
  }

  @Input({ required: true })
  set evidenceCoveragePercent(value: number) {
    this.evidenceCoveragePercentSignal.set(value);
  }

  @Input()
  set isPiiPassed(value: boolean | null) {
    this.isPiiPassedSignal.set(value);
  }

  @Input({ required: true })
  set leakedPatternsCount(value: number) {
    this.leakedPatternsCountSignal.set(value);
  }

  @Input({ required: true })
  set finopsReduction(value: number) {
    this.finopsReductionSignal.set(value);
  }

  @Input({ required: true })
  set estimatedTokensSaved(value: number) {
    this.estimatedTokensSavedSignal.set(value);
  }

  /**
   * Updates the active evidence tab signal when a valid tab identifier is selected.
   */
  onTabChange(tab: string | number | undefined): void {
    if (isFilled(tab)) {
      this.activeTab.set(String(tab));
    }
  }
}
