import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { escapeHtml, isNonEmptyString, stripUnsafeHtml } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { IncidentState, NotificationStatus, type IncidentDetail } from '../../core/contract.js';
import { I18nService } from '../../core/i18n.service.js';

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
  private readonly sanitizer: DomSanitizer | null;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly displayedFsmStateSignal = signal<IncidentState | undefined>(undefined);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);

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

  readonly safeResendPreview = computed<SafeHtml | string>(() => {
    const html = this.buildPreviewHtml();
    return this.sanitizer ? this.sanitizer.bypassSecurityTrustHtml(html) : html;
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
    const notification = this.incidentSignal()?.notification;
    const raw = notification?.htmlPreview;

    if (
      notification?.status === NotificationStatus.DEGRADED ||
      (isNonEmptyString(raw) && raw.startsWith('Warning: Resend delivery failed'))
    ) {
      return `
      <div style="font-family: sans-serif; color: #fde68a;">
        <h3 style="color: #fbbf24; margin-top: 0; font-size: 12px;">${this.i18n.t('resendDegradedTitle')}</h3>
        <p style="font-size: 11px; color: #cbd5e1; margin-bottom: 6px;">${this.i18n.t('resendDegradedBody')}</p>
      </div>
    `;
    }

    if (
      notification?.status === NotificationStatus.DISPATCHED &&
      (!isNonEmptyString(raw) || !raw.trim().startsWith('<'))
    ) {
      return `
      <div style="font-family: sans-serif; color: #cbd5e1;">
        <h3 style="color: #34d399; margin-top: 0; font-size: 12px;">✅ ${this.i18n.t('resendDispatchedBadge')}</h3>
        <p style="font-size: 11px; margin-bottom: 4px;">${this.i18n.t('resendDispatchedBody')}</p>
        <p style="font-size: 10px; color: #94a3b8; font-family: monospace;">ID: ${escapeHtml(notification.emailId ?? '')}</p>
      </div>
    `;
    }

    if (isNonEmptyString(raw)) {
      return stripUnsafeHtml(raw);
    }

    return `
    <div style="font-family: sans-serif; color: #cbd5e1;">
      <h3 style="color: #ef4444; margin-top: 0;">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p style="font-size: 11px;">${this.i18n.t('resendDefaultBody')}</p>
    </div>
  `;
  }
}
