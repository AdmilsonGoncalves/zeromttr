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
import { escapeHtml, isNonEmptyString } from '@zeromttr/utils';
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
  readonly sanitizer: DomSanitizer;

  readonly incidentSignal = signal<IncidentDetail | null>(null);
  readonly displayedFsmStateSignal = signal<IncidentState | undefined>(undefined);

  @Input()
  set incident(value: IncidentDetail | null) {
    this.incidentSignal.set(value);
  }

  @Input()
  set displayedFsmState(value: IncidentState | undefined) {
    this.displayedFsmStateSignal.set(value);
  }

  @Output() readonly simulateDecision = new EventEmitter<void>();

  readonly safeResendPreview = computed<SafeHtml>(() => {
    const notification = this.incidentSignal()?.notification;
    const raw = notification?.htmlPreview;

    if (
      notification?.status === NotificationStatus.DEGRADED ||
      (isNonEmptyString(raw) && raw.startsWith('Warning: Resend delivery failed'))
    ) {
      const degradedHtml = `
      <div style="font-family: sans-serif; color: #fde68a;">
        <h3 style="color: #fbbf24; margin-top: 0; font-size: 12px;">${this.i18n.t('resendDegradedTitle')}</h3>
        <p style="font-size: 11px; color: #cbd5e1; margin-bottom: 6px;">${this.i18n.t('resendDegradedBody')}</p>
      </div>
    `;
      return this.sanitizer.bypassSecurityTrustHtml(degradedHtml);
    }

    if (
      notification?.status === NotificationStatus.DISPATCHED &&
      (!isNonEmptyString(raw) || !raw.trim().startsWith('<'))
    ) {
      const dispatchedHtml = `
      <div style="font-family: sans-serif; color: #cbd5e1;">
        <h3 style="color: #34d399; margin-top: 0; font-size: 12px;">✅ ${this.i18n.t('resendDispatchedBadge')}</h3>
        <p style="font-size: 11px; margin-bottom: 4px;">${this.i18n.t('resendDispatchedBody')}</p>
        <p style="font-size: 10px; color: #94a3b8; font-family: monospace;">ID: ${escapeHtml(notification.emailId ?? '')}</p>
      </div>
    `;
      return this.sanitizer.bypassSecurityTrustHtml(dispatchedHtml);
    }

    const defaultPreview = `
    <div style="font-family: sans-serif; color: #cbd5e1;">
      <h3 style="color: #ef4444; margin-top: 0;">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p style="font-size: 11px;">${this.i18n.t('resendDefaultBody')}</p>
    </div>
  `;
    return this.sanitizer.bypassSecurityTrustHtml(raw ?? defaultPreview);
  });

  constructor(...args: [I18nService?, DomSanitizer?]) {
    const [i18n, sanitizer] = args;
    this.i18n = i18n ?? inject(I18nService);
    if (sanitizer) {
      this.sanitizer = sanitizer;
    } else {
      try {
        this.sanitizer =
          inject(DomSanitizer, { optional: true }) ??
          ({
            bypassSecurityTrustHtml: (html: string) => html as unknown as SafeHtml
          } as DomSanitizer);
      } catch {
        this.sanitizer = {
          bypassSecurityTrustHtml: (html: string) => html as unknown as SafeHtml
        } as DomSanitizer;
      }
    }
  }
}
