import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  SecurityContext,
  computed,
  inject,
  signal
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { escapeHtml, isNonEmptyString, stripUnsafeHtml } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { UiSeverity } from '../../core/constants.js';
import { IncidentState, NotificationStatus, type IncidentDetail } from '../../core/contract.js';
import { I18nService, type TranslationDictionary } from '../../core/i18n/i18n.service.js';

export interface PrBadgeConfig {
  labelKey: keyof TranslationDictionary;
  severity: UiSeverity;
}

/**
 * Right War Room quadrant displaying GitHub PR status, Resend post-mortem preview, and human decision controls.
 */
@Component({
  selector: 'app-remediation-panel',
  imports: [Tag, Button, Tooltip],
  templateUrl: './remediation-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemediationPanelComponent {
  readonly i18n: I18nService;
  readonly incidentState = IncidentState;
  private readonly sanitizer: DomSanitizer | null;

  readonly demoModeEnabledSignal = signal<boolean>(true);
  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly displayedFsmStateSignal = signal<IncidentState | undefined>(undefined);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);

  @Input()
  set demoModeEnabled(value: boolean) {
    this.demoModeEnabledSignal.set(value);
  }

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input()
  set displayedFsmState(value: IncidentState | undefined) {
    this.displayedFsmStateSignal.set(value);
  }

  @Input()
  set simulationLockedByTurnstile(value: boolean) {
    this.simulationLockedByTurnstileSignal.set(value);
  }

  @Output() readonly simulateDecision = new EventEmitter<void>();

  readonly prBadge = computed<PrBadgeConfig>(() => {
    const incident = this.incidentSignal();
    if (!incident?.remediation) {
      return { labelKey: 'githubPrIdleStatus', severity: UiSeverity.SECONDARY };
    }
    const state = this.displayedFsmStateSignal() ?? incident.state;
    if (state === IncidentState.RESOLVED) {
      return { labelKey: 'githubPrApprovedStatus', severity: UiSeverity.SUCCESS };
    }
    if (state === IncidentState.REJECTED) {
      return { labelKey: 'githubPrRejectedStatus', severity: UiSeverity.DANGER };
    }
    if (state === IncidentState.FAILED) {
      return { labelKey: 'githubPrClosedStatus', severity: UiSeverity.DANGER };
    }
    return { labelKey: 'githubPrOpenStatus', severity: UiSeverity.SUCCESS };
  });

  readonly safeResendPreview = computed<string>(() => {
    const cleanHtml = stripUnsafeHtml(this.buildPreviewHtml());
    if (this.sanitizer) {
      return this.sanitizer.sanitize(SecurityContext.HTML, cleanHtml) ?? '';
    }
    return cleanHtml;
  });

  constructor(...args: [I18nService?, DomSanitizer?]) {
    const [i18n, sanitizer] = args;
    this.i18n = i18n ?? inject(I18nService);
    if (sanitizer) {
      this.sanitizer = sanitizer;
    } else {
      try {
        this.sanitizer = inject(DomSanitizer, { optional: true });
      } catch {
        this.sanitizer = null;
      }
    }
  }

  private buildPreviewHtml(): string {
    const incident = this.incidentSignal();
    if (!incident) {
      return `
      <div class="font-sans text-slate-400">
        <p class="text-[11px] m-0">${this.i18n.t('resendIdleBody')}</p>
      </div>
    `;
    }

    const notification = incident.notification;
    const raw = notification?.htmlPreview;

    if (
      notification?.status === NotificationStatus.DEGRADED ||
      (isNonEmptyString(raw) && raw.startsWith('Warning: Resend delivery failed'))
    ) {
      return `
      <div class="font-sans text-amber-200">
        <h3 class="text-amber-400 mt-0 mb-1 text-xs font-semibold">${this.i18n.t('resendDegradedTitle')}</h3>
        <p class="text-[11px] text-slate-300 mb-1.5">${this.i18n.t('resendDegradedBody')}</p>
      </div>
    `;
    }

    if (
      notification?.status === NotificationStatus.DISPATCHED &&
      (!isNonEmptyString(raw) || !raw.trim().startsWith('<'))
    ) {
      return `
      <div class="font-sans text-slate-300">
        <h3 class="text-emerald-400 mt-0 mb-1 text-xs font-semibold">✅ ${this.i18n.t('resendDispatchedBadge')}</h3>
        <p class="text-[11px] mb-1">${this.i18n.t('resendDispatchedBody')}</p>
        <p class="text-[10px] text-slate-400 font-mono">ID: ${escapeHtml(notification.emailId ?? '')}</p>
      </div>
    `;
    }

    if (isNonEmptyString(raw)) {
      return raw;
    }

    return `
    <div class="font-sans text-slate-300">
      <h3 class="text-rose-500 mt-0 mb-1 font-semibold">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p class="text-[11px]">${this.i18n.t('resendDefaultBody')}</p>
    </div>
  `;
  }
}
