// @vitest-environment happy-dom
import '@angular/compiler';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INCIDENT } from '../../mock-server/mock-data.js';
import { I18nService } from '../../src/app/core/i18n/i18n.service.js';
import { IncidentService } from '../../src/app/core/incident.service.js';
import { SystemSettingsService } from '../../src/app/core/system-settings.service.js';
import { DecisionComponent } from '../../src/app/decision/decision.component.js';
import { RemediationPanelComponent } from '../../src/app/war-room/remediation-panel/remediation-panel.component.js';
import { WarRoomComponent } from '../../src/app/war-room/war-room.component.js';
import { createDashboardFixture } from '../helpers/testbed.helper.js';

describe('Dashboard Components Integration (TestBed + happy-dom)', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('should_render_DecisionComponent_run_ngOnInit_automatically_and_submit_valid_hmac_decision', async () => {
    const i18n = new I18nService();
    const incidentService = new IncidentService();
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    window.location.hash = `#action=approve&sig=hmac_integration_sig&exp=${futureExp}`;

    vi.spyOn(incidentService, 'getIncidentDetail').mockResolvedValue(null);
    const submitSpy = vi.spyOn(incidentService, 'submitDecision').mockResolvedValue(true);

    const mockRoute = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'id' ? 'inc-20261126-001' : null)
        }
      }
    } as unknown as ActivatedRoute;

    const fixture = createDashboardFixture(DecisionComponent, {
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: I18nService, useValue: i18n },
        { provide: IncidentService, useValue: incidentService }
      ]
    });

    const hostEl = fixture.nativeElement as HTMLElement;
    expect(hostEl.textContent).toContain('inc-20261126-001');
    expect(hostEl.textContent).toContain('APPROVE');
    expect(fixture.componentInstance.isValid()).toBe(true);

    await fixture.componentInstance.executeDecision();
    fixture.detectChanges();

    expect(submitSpy).toHaveBeenCalledWith('inc-20261126-001', {
      action: 'approve',
      sig: 'hmac_integration_sig',
      exp: futureExp
    });
    expect(hostEl.textContent).toContain(i18n.t('decisionSuccessMsg'));

    fixture.destroy();
  });

  it('should_render_DecisionComponent_error_banner_when_hmac_fragment_is_missing', () => {
    const i18n = new I18nService();
    const incidentService = new IncidentService();
    window.location.hash = '';

    vi.spyOn(incidentService, 'getIncidentDetail').mockResolvedValue(null);

    const mockRoute = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'id' ? 'inc-20261126-002' : null)
        }
      }
    } as unknown as ActivatedRoute;

    const fixture = createDashboardFixture(DecisionComponent, {
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: I18nService, useValue: i18n },
        { provide: IncidentService, useValue: incidentService }
      ]
    });

    const hostEl = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.isValid()).toBe(false);
    expect(hostEl.textContent).toContain(i18n.t('hmacMissingFragmentError'));

    fixture.destroy();
  });

  it('should_render_WarRoomComponent_tree_and_invoke_lifecycle_hooks_via_Angular', () => {
    const i18n = new I18nService();
    const incidentService = new IncidentService();
    const settingsService = new SystemSettingsService();

    const connectSpy = vi.spyOn(incidentService, 'connectSse').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(incidentService, 'disconnectSse').mockImplementation(() => {});
    const startPollSpy = vi
      .spyOn(incidentService, 'startTargetStatusPolling')
      .mockImplementation(() => {});
    const stopPollSpy = vi
      .spyOn(incidentService, 'stopTargetStatusPolling')
      .mockImplementation(() => {});
    const fetchDemoSpy = vi.spyOn(incidentService, 'fetchDemoConfig').mockResolvedValue();
    const fetchTargetSpy = vi.spyOn(incidentService, 'fetchTargetStatus').mockResolvedValue();
    const fetchIncidentsSpy = vi.spyOn(incidentService, 'fetchIncidents').mockResolvedValue();
    const fetchSettingsSpy = vi.spyOn(settingsService, 'fetchSettings').mockResolvedValue(true);

    const fixture = createDashboardFixture(WarRoomComponent, {
      providers: [
        { provide: I18nService, useValue: i18n },
        { provide: IncidentService, useValue: incidentService },
        { provide: SystemSettingsService, useValue: settingsService }
      ]
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(startPollSpy).toHaveBeenCalledTimes(1);
    expect(fetchDemoSpy).toHaveBeenCalledTimes(1);
    expect(fetchTargetSpy).toHaveBeenCalledTimes(1);
    expect(fetchIncidentsSpy).toHaveBeenCalledTimes(1);
    expect(fetchSettingsSpy).toHaveBeenCalledTimes(1);

    const hostEl = fixture.nativeElement as HTMLElement;
    expect(hostEl.querySelector('p-toast')).not.toBeNull();
    expect(hostEl.querySelector('app-war-room-header')).not.toBeNull();
    expect(hostEl.querySelector('app-war-room-notices')).not.toBeNull();
    expect(hostEl.querySelector('app-fsm-timeline')).not.toBeNull();
    expect(hostEl.querySelector('app-target-telemetry')).not.toBeNull();
    expect(hostEl.querySelector('app-war-room-kpis')).not.toBeNull();
    expect(hostEl.querySelector('app-evidence-panel')).not.toBeNull();
    expect(hostEl.querySelector('app-remediation-panel')).not.toBeNull();

    fixture.destroy();
    expect(stopPollSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('should_sanitize_html_with_real_Angular_DomSanitizer_in_RemediationPanelComponent', () => {
    const i18n = new I18nService();
    const fixture = createDashboardFixture(RemediationPanelComponent, {
      providers: [{ provide: I18nService, useValue: i18n }]
    });

    const unsafeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    unsafeIncident.notification = {
      emailId: 'email-sanitizer-test',
      status: 'DISPATCHED',
      htmlPreview:
        '<div><script>window.__xss = true;</script><img src="x" onerror="alert(1)" /><p>Post-mortem summary</p></div>'
    };

    fixture.componentRef.setInput('incident', unsafeIncident);
    fixture.detectChanges();

    const hostEl = fixture.nativeElement as HTMLElement;
    expect(hostEl.textContent).toContain('Post-mortem summary');
    expect(hostEl.querySelector('script')).toBeNull();
    expect(fixture.componentInstance.safeResendPreview()).not.toContain('onerror');

    fixture.destroy();
  });
});
