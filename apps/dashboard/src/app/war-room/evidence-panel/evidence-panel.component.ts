import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { isFilled, isNonEmptyString, isObject, safeJsonParse } from '@zeromttr/utils';
import { ProgressBar } from 'primeng/progressbar';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import {
  MASKED_POST_OTTL_LOG,
  MOCK_GIT_DIFF,
  RAW_PRE_COLLECTOR_LOG
} from '../../core/constants.js';
import type { IncidentDetail, TargetStatusResponse } from '../../core/contract.js';
import { I18nService } from '../../core/i18n.service.js';

/**
 * Center War Room quadrant displaying OTel trace tree, Loki PII masking comparison, and Git diff / FinOps.
 */
@Component({
  selector: 'app-evidence-panel',
  imports: [CommonModule, Tabs, TabList, Tab, TabPanels, TabPanel, ProgressBar],
  templateUrl: './evidence-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EvidencePanelComponent {
  readonly i18n: I18nService;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);
  readonly isPiiPassedSignal = signal<boolean | null>(null);
  readonly leakedPatternsCountSignal = signal<number>(0);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input()
  set targetStatus(value: TargetStatusResponse | null) {
    this.targetStatusSignal.set(value);
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

  readonly activeTab = signal<string>('0');
  readonly mockGitDiff = MOCK_GIT_DIFF;
  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  readonly displayedPreCollectorLog = computed<string>(() => {
    return (
      this.incidentSignal()?.rca?.rawEdgeLogPreCollector ??
      this.targetStatusSignal()?.rawEdgeLogPreCollector ??
      this.rawPreCollectorLog
    );
  });

  readonly displayedPostOttlLog = computed<string>(() => {
    if (this.isPiiPassedSignal() === false) {
      const types = (this.incidentSignal()?.rca?.piiGuardAudit?.detectedTypes ?? []).join(', ');
      return this.i18n.t('piiLogWithheldMessage').replace('{TYPES}', types);
    }

    const sample = this.incidentSignal()?.rca?.logSample;
    if (!isNonEmptyString(sample)) {
      return this.maskedPostOttlLog;
    }

    const lines = sample
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const parsed = safeJsonParse<Record<string, unknown>>(line);
      if (isObject(parsed) && isNonEmptyString(parsed.body)) {
        return parsed.body;
      }
      const bodyMatch = line.match(/^\{"body":"((?:[^"\\]|\\.)*)"/);
      if (bodyMatch?.[1]) {
        return bodyMatch[1].replace(/\\"/g, '"');
      }
    }

    return lines[0] ?? this.maskedPostOttlLog;
  });

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
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
