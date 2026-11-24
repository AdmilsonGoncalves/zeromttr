import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProgressBar } from 'primeng/progressbar';
import type { IncidentDetail } from '../../../core/contract.js';
import { I18nService } from '../../../core/i18n.service.js';

/**
 * Displays OTel evidence coverage, blast radius, RCA summary, and hierarchical span tree.
 */
@Component({
  selector: 'app-trace-tree-tab',
  imports: [CommonModule, ProgressBar],
  templateUrl: './trace-tree-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TraceTreeTabComponent {
  readonly i18n: I18nService;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input({ required: true })
  set signalsRatio(value: string) {
    this.signalsRatioSignal.set(value);
  }

  @Input({ required: true })
  set evidenceCoveragePercent(value: number) {
    this.evidenceCoveragePercentSignal.set(value);
  }

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }
}
