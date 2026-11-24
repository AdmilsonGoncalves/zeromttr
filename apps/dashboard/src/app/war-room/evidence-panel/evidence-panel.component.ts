import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
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

  readonly incident = input<IncidentDetail | null>(null);
  readonly targetStatus = input<TargetStatusResponse | null>(null);
  readonly signalsRatio = input.required<string>();
  readonly evidenceCoveragePercent = input.required<number>();
  readonly isPiiPassed = input<boolean | null>(null);
  readonly leakedPatternsCount = input.required<number>();
  readonly finopsReduction = input.required<number>();
  readonly estimatedTokensSaved = input.required<number>();

  readonly activeTab = signal<string>('0');
  readonly mockGitDiff = MOCK_GIT_DIFF;
  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  readonly displayedPreCollectorLog = computed<string>(() => {
    return (
      this.incident()?.rca?.rawEdgeLogPreCollector ??
      this.targetStatus()?.rawEdgeLogPreCollector ??
      this.rawPreCollectorLog
    );
  });

  readonly displayedPostOttlLog = computed<string>(() => {
    if (this.isPiiPassed() === false) {
      const types = (this.incident()?.rca?.piiGuardAudit?.detectedTypes ?? []).join(', ');
      return this.i18n.t('piiLogWithheldMessage').replace('{TYPES}', types);
    }

    const sample = this.incident()?.rca?.logSample;
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

  constructor(i18n?: I18nService) {
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
