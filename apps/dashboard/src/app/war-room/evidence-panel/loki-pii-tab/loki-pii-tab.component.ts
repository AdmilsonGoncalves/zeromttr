import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { isNonEmptyString, isObject, safeJsonParse } from '@zeromttr/utils';
import { MASKED_POST_OTTL_LOG, RAW_PRE_COLLECTOR_LOG } from '../../../core/constants.js';
import type { IncidentDetail, TargetStatusResponse } from '../../../core/contract.js';
import { I18nService } from '../../../core/i18n/i18n.service.js';

/**
 * Displays PII guard audit status and side-by-side Pre-Collector vs Post-OTTL masked Loki logs.
 */
@Component({
  selector: 'app-loki-pii-tab',
  imports: [],
  templateUrl: './loki-pii-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LokiPiiTabComponent {
  readonly i18n: I18nService;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly isPiiPassedSignal = signal<boolean | null>(null);
  readonly leakedPatternsCountSignal = signal<number>(0);

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input()
  set targetStatus(value: TargetStatusResponse | null) {
    this.targetStatusSignal.set(value);
  }

  @Input()
  set isPiiPassed(value: boolean | null) {
    this.isPiiPassedSignal.set(value);
  }

  @Input({ required: true })
  set leakedPatternsCount(value: number) {
    this.leakedPatternsCountSignal.set(value);
  }

  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  readonly displayedPreCollectorLog = computed<string>(() => {
    const incident = this.incidentSignal();
    if (!incident) {
      return this.i18n.t('piiIdlePreCollectorLog');
    }

    return (
      incident.rca?.rawEdgeLogPreCollector ??
      this.targetStatusSignal()?.rawEdgeLogPreCollector ??
      this.rawPreCollectorLog
    );
  });

  readonly displayedPostOttlLog = computed<string>(() => {
    const incident = this.incidentSignal();
    if (!incident) {
      return this.i18n.t('piiIdlePostOttlLog');
    }

    if (this.isPiiPassedSignal() === false) {
      const types = (incident.rca?.piiGuardAudit?.detectedTypes ?? []).join(', ');
      return this.i18n.t('piiLogWithheldMessage').replace('{TYPES}', types);
    }

    const sample = incident.rca?.logSample;
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
}
