import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INCIDENT } from '../../../mock-server/mock-data.js';
import { IncidentState, NotificationStatus } from '../../../src/app/core/contract.js';
import { I18nService, Language } from '../../../src/app/core/i18n/i18n.service.js';
import { RemediationPanelComponent } from '../../../src/app/war-room/remediation-panel/remediation-panel.component.js';
import { createWithInjector } from '../../helpers/di.helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REMEDIATION_TEMPLATE_PATH = resolve(
  HERE,
  '../../../src/app/war-room/remediation-panel/remediation-panel.component.html'
);

describe('RemediationPanelComponent', () => {
  let i18n: I18nService;
  let component: RemediationPanelComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = createWithInjector(RemediationPanelComponent, [
      { provide: I18nService, useValue: i18n }
    ]);
  });

  it('should_render_idle_preview_when_no_incident_is_active', () => {
    expect(component.safeResendPreview()).toContain(i18n.t('resendIdleBody'));
    expect(component.safeResendPreview()).not.toContain(i18n.t('resendDefaultTitle'));
    expect(component.safeResendPreview()).not.toContain(i18n.t('resendDefaultBody'));
  });

  it('should_render_default_preview_when_active_incident_has_no_notification', () => {
    const activeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    delete activeIncident.notification;
    component.incident = activeIncident;

    expect(component.safeResendPreview()).toContain(i18n.t('resendDefaultTitle'));
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

  it('should emit simulateDecision when triggered and gate button on demoModeEnabled', () => {
    expect(component.demoModeEnabledSignal()).toBe(true);
    component.demoModeEnabled = false;
    expect(component.demoModeEnabledSignal()).toBe(false);

    const html = readFileSync(REMEDIATION_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('@if (demoModeEnabledSignal())');
    expect(html).toContain('simulateDecisionBtn');

    const spy = vi.fn();
    component.simulateDecision.subscribe(spy);
    component.simulateDecision.emit();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should_update_pr_badge_across_idle_open_resolved_rejected_and_failed_states', () => {
    expect(component.prBadge()).toEqual({ labelKey: 'githubPrIdleStatus', severity: 'secondary' });

    const html = readFileSync(REMEDIATION_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('hotfix/zeromttr-pool-timeout');
    expect(html).not.toContain('github.com/AdmilsonGoncalves/zeromttr/pull/42');
    expect(html).toContain("i18n.t('githubPrIdleBody')");

    const incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    component.incident = incident;
    component.displayedFsmState = IncidentState.NOTIFIED;
    expect(component.prBadge()).toEqual({ labelKey: 'githubPrOpenStatus', severity: 'success' });

    component.displayedFsmState = IncidentState.RESOLVED;
    expect(component.prBadge()).toEqual({
      labelKey: 'githubPrApprovedStatus',
      severity: 'success'
    });

    component.displayedFsmState = IncidentState.REJECTED;
    expect(component.prBadge()).toEqual({ labelKey: 'githubPrRejectedStatus', severity: 'danger' });

    component.displayedFsmState = IncidentState.FAILED;
    expect(component.prBadge()).toEqual({ labelKey: 'githubPrClosedStatus', severity: 'danger' });

    component.incident = null;
    component.displayedFsmState = undefined;
    expect(component.prBadge()).toEqual({ labelKey: 'githubPrIdleStatus', severity: 'secondary' });
  });
});
