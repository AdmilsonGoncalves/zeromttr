import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { NotificationStatus } from '../src/app/core/contract.js';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';
import { RemediationPanelComponent } from '../src/app/war-room/remediation-panel/remediation-panel.component.js';

describe('RemediationPanelComponent', () => {
  let i18n: I18nService;
  let component: RemediationPanelComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new RemediationPanelComponent(i18n);
  });

  it('should_render_idle_preview_when_no_incident_is_active', () => {
    expect(component.safeResendPreview()).toContain(i18n.t('resendIdleBody'));
    expect(component.safeResendPreview()).not.toContain('🚨 ZeroMTTR Incident Post-Mortem');
    expect(component.safeResendPreview()).not.toContain(i18n.t('resendDefaultBody'));
  });

  it('should_render_default_preview_when_active_incident_has_no_notification', () => {
    const activeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    delete activeIncident.notification;
    component.incident = activeIncident;

    expect(component.safeResendPreview()).toContain('🚨 ZeroMTTR Incident Post-Mortem');
    expect(component.safeResendPreview()).toContain(i18n.t('resendDefaultBody'));
  });

  it('should_reset_preview_back_to_idle_when_incident_is_cleared', () => {
    component.incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    expect(component.safeResendPreview()).not.toContain(i18n.t('resendIdleBody'));

    component.incident = null;
    expect(component.safeResendPreview()).toContain(i18n.t('resendIdleBody'));

    i18n.setLang(Language.EN_US);
    expect(component.safeResendPreview()).toContain(i18n.t('resendIdleBody'));
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

    i18n.setLang(Language.EN_US);
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
      htmlPreview:
        '<div onclick="alert(1)"><script>evil()</script><a href="&#106;avascript:alert(1)">Bad</a><a href="https://example.com/pr/1">Safe Link</a><p>Safe body</p></div>'
    };
    component.incident = unsafeIncident;

    const preview = String(component.safeResendPreview());
    expect(preview).toContain('Safe body');
    expect(preview).toContain('https://example.com/pr/1');
    expect(preview).not.toContain('<script');
    expect(preview).not.toContain('onclick=');
    expect(preview).not.toContain('&#106;avascript:');
  });

  it('should_not_emit_inline_style_attributes_that_trigger_angular_sanitizer_warnings', () => {
    expect(component.safeResendPreview()).not.toMatch(/\sstyle\s*=/i);

    const htmlIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    htmlIncident.notification.htmlPreview =
      '<div style="color: #0f172a;"><h2 style="color: red;">Title</h2><p>Clean body</p></div>';
    component.incident = htmlIncident;

    const rendered = component.safeResendPreview();
    expect(rendered).toContain('Title');
    expect(rendered).toContain('Clean body');
    expect(rendered).not.toMatch(/\sstyle\s*=/i);
  });

  it('should_emit_simulate_decision_when_triggered', () => {
    const spy = vi.fn();
    component.simulateDecision.subscribe(spy);
    component.simulateDecision.emit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
