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

  it('should_render_default_preview_when_no_incident_notification_is_set', () => {
    expect(component.safeResendPreview()).toContain('🚨 ZeroMTTR Incident Post-Mortem');
  });

  it('should_render_degraded_html_preview_across_languages', () => {
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

  it('should_render_dispatched_fallback_preview_with_escaped_email_id_when_html_preview_is_plain_text', () => {
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

  it('should_strip_unsafe_scripts_and_event_handlers_from_raw_html_preview', () => {
    const unsafeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    unsafeIncident.notification = {
      emailId: 'email-unsafe-1',
      status: NotificationStatus.DISPATCHED,
      htmlPreview: '<div onclick="alert(1)"><script>evil()</script><p>Safe body</p></div>'
    };
    component.incident = unsafeIncident;

    const preview = String(component.safeResendPreview());
    expect(preview).toContain('Safe body');
    expect(preview).not.toContain('<script');
    expect(preview).not.toContain('onclick=');
  });

  it('should_emit_simulate_decision_when_triggered', () => {
    const spy = vi.fn();
    component.simulateDecision.subscribe(spy);
    component.simulateDecision.emit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
