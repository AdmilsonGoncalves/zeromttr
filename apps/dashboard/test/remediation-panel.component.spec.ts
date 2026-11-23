import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { NotificationStatus } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { RemediationPanelComponent } from '../src/app/war-room/remediation-panel/remediation-panel.component.js';

describe('RemediationPanelComponent', () => {
  let i18n: I18nService;
  let component: RemediationPanelComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new RemediationPanelComponent(i18n);
  });

  it('should render default preview when no incident notification is set', () => {
    expect(component.safeResendPreview()).toContain('🚨 ZeroMTTR Incident Post-Mortem');
  });

  it('should render degraded HTML preview across languages', () => {
    const degradedIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    degradedIncident.notification = {
      emailId: 'email-fallback-1',
      status: NotificationStatus.DEGRADED,
      htmlPreview: 'Warning: Resend delivery failed (403). Notification in degraded mode.'
    };
    component.incident = degradedIncident;

    expect(component.safeResendPreview()).toContain(i18n.t('resendDegradedTitle'));

    i18n.setLang('en');
    expect(component.safeResendPreview()).toContain(i18n.t('resendDegradedTitle'));
  });

  it('should render dispatched fallback preview with escaped emailId when htmlPreview is plain text', () => {
    const dispatchedIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    dispatchedIncident.notification = {
      emailId: '<script>alert(1)</script>',
      status: NotificationStatus.DISPATCHED,
      htmlPreview: 'Dispatched'
    };
    component.incident = dispatchedIncident;

    const preview = String(component.safeResendPreview());
    expect(preview).toContain(i18n.t('resendDispatchedBadge'));
    expect(preview).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('should emit simulateDecision when triggered', () => {
    const spy = vi.fn();
    component.simulateDecision.subscribe(spy);
    component.simulateDecision.emit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
