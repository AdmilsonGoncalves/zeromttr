import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { type ReasoningSource } from '../../core/contract.js';
import { I18nService } from '../../core/i18n.service.js';

/**
 * Decoupled War Room KPI strip showing TTD, TTPR, evidence coverage, reasoning source, and FinOps payload savings.
 */
@Component({
  selector: 'app-war-room-kpis',
  imports: [],
  templateUrl: './war-room-kpis.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomKpisComponent {
  readonly i18n: I18nService;

  readonly ttdDisplaySignal = signal<string>('--');
  readonly ttprDisplaySignal = signal<string>('--');
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);
  readonly reasoningSourceSignal = signal<ReasoningSource | null>(null);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);

  @Input({ required: true })
  set ttdDisplay(value: string) {
    this.ttdDisplaySignal.set(value);
  }

  @Input({ required: true })
  set ttprDisplay(value: string) {
    this.ttprDisplaySignal.set(value);
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
  set reasoningSource(value: ReasoningSource | null) {
    this.reasoningSourceSignal.set(value);
  }

  @Input({ required: true })
  set finopsReduction(value: number) {
    this.finopsReductionSignal.set(value);
  }

  @Input({ required: true })
  set estimatedTokensSaved(value: number) {
    this.estimatedTokensSavedSignal.set(value);
  }

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }
}
