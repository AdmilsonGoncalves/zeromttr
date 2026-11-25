import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { round } from '@zeromttr/utils';
import { MOCK_GIT_DIFF } from '../../../core/constants.js';
import type { IncidentDetail } from '../../../core/contract.js';
import { I18nService } from '../../../core/i18n/i18n.service.js';

/**
 * Displays Git deploy diff context and FinOps payload/token reduction metrics.
 */
@Component({
  selector: 'app-git-diff-finops-tab',
  imports: [],
  templateUrl: './git-diff-finops-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GitDiffFinopsTabComponent {
  readonly i18n: I18nService;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);
  readonly mockGitDiff = MOCK_GIT_DIFF;

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input({ required: true })
  set finopsReduction(value: number) {
    this.finopsReductionSignal.set(value);
  }

  @Input({ required: true })
  set estimatedTokensSaved(value: number) {
    this.estimatedTokensSavedSignal.set(value);
  }

  readonly finopsCompactedBarPercent = computed<number>(() => {
    const finops = this.incidentSignal()?.finops;
    const raw = finops?.rawBytesFetched ?? 48200;
    const compacted = finops?.compactedBytesSent ?? 7712;
    if (raw <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(2, round((compacted / raw) * 100, 1)));
  });

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }
}
