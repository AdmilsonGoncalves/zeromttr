import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarRoomComponent } from '../../../src/app/war-room/war-room.component.js';
import { TargetHealthStatus } from '../../../src/app/core/contract.js';
import { I18nService, Language } from '../../../src/app/core/i18n/i18n.service.js';
import { IncidentService } from '../../../src/app/core/incident.service.js';
import { MOCK_INCIDENT } from '../../../mock-server/mock-data.js';
import { createWithInjector } from '../../helpers/di.helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WAR_ROOM_TEMPLATE_PATH = resolve(HERE, '../../../src/app/war-room/war-room.component.html');

describe('WarRoomComponent', () => {
  let component: WarRoomComponent;
  let i18n: I18nService;
  let incidentService: IncidentService;

  beforeEach(() => {
    i18n = new I18nService();
    incidentService = new IncidentService();

    // Mock fetch calls for ngOnInit
    vi.spyOn(incidentService, 'connectSse').mockImplementation(() => {});
    vi.spyOn(incidentService, 'disconnectSse').mockImplementation(() => {});
    vi.spyOn(incidentService, 'fetchDemoConfig').mockImplementation(async () => {});
    vi.spyOn(incidentService, 'fetchTargetStatus').mockImplementation(async () => {});
    vi.spyOn(incidentService, 'fetchIncidents').mockImplementation(async () => {});

    // Instantiate component inside a synthetic Angular injection context
    component = createWithInjector(WarRoomComponent, [
      { provide: I18nService, useValue: i18n },
      { provide: IncidentService, useValue: incidentService }
    ]);
  });

  it('should initialize, fetch demo config, and connect SSE on ngOnInit', () => {
    component.ngOnInit();
    expect(incidentService.connectSse).toHaveBeenCalled();
    expect(incidentService.fetchDemoConfig).toHaveBeenCalled();
    expect(incidentService.fetchTargetStatus).toHaveBeenCalled();
    expect(incidentService.fetchIncidents).toHaveBeenCalled();
  });

  it('should lock simulations when Turnstile is required until a token is provided', () => {
    incidentService.turnstileRequired.set(true);
    expect(incidentService.isSimulationLockedByTurnstile()).toBe(true);

    component.onTurnstileTokenChange('cf-valid-token');
    expect(incidentService.isSimulationLockedByTurnstile()).toBe(false);

    component.onTurnstileTokenChange(null);
    expect(incidentService.isSimulationLockedByTurnstile()).toBe(true);
  });

  it('should disconnect SSE on ngOnDestroy', () => {
    component.ngOnDestroy();
    expect(incidentService.disconnectSse).toHaveBeenCalled();
  });

  it('should toggle active mode between live and replay and force-stop active healthy traffic when leaving live mode', async () => {
    const toggleSpy = vi
      .spyOn(incidentService, 'toggleHealthyTraffic')
      .mockResolvedValue({ ok: true, status: 200 });
    const toastSpy = vi.spyOn(component.messageService, 'add');

    expect(incidentService.activeMode()).toBe('replay');
    component.onModeChange('live');
    expect(incidentService.activeMode()).toBe('live');
    expect(toggleSpy).not.toHaveBeenCalled();

    // Without active healthy traffic, returning to replay should not invoke the toggle endpoint
    component.onModeChange('replay');
    expect(incidentService.activeMode()).toBe('replay');
    expect(toggleSpy).not.toHaveBeenCalled();

    // With active healthy traffic, disabling live mode must immediately force-stop healthy traffic
    component.onModeChange('live');
    incidentService.targetStatus.set({
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      },
      metrics: {
        requestsPerSecond: 12,
        errorRate5xxPercent: 0,
        p95LatencyMs: 25,
        healthyTrafficActive: true
      }
    });

    component.onModeChange('replay');
    expect(incidentService.activeMode()).toBe('replay');
    await vi.waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(false);
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: i18n.t('toastHealthyTrafficStoppedSummary')
      })
    );
  });

  it('should_stop_healthy_traffic_if_live_mode_is_disabled_while_enable_request_is_in_flight', async () => {
    let resolveEnable!: (result: { ok: boolean; status: number }) => void;
    const toggleSpy = vi
      .spyOn(incidentService, 'toggleHealthyTraffic')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveEnable = resolve;
          })
      )
      .mockResolvedValueOnce({ ok: true, status: 200 });

    component.onModeChange('live');
    incidentService.isTogglingTraffic.set(true);
    const pendingEnable = component.onToggleHealthyTraffic();

    // User switches back to Replay before the enable request settles
    component.onModeChange('replay');
    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(toggleSpy).toHaveBeenCalledWith(true);

    incidentService.isTogglingTraffic.set(false);
    resolveEnable({ ok: true, status: 200 });
    await pendingEnable;

    expect(toggleSpy).toHaveBeenCalledTimes(2);
    expect(toggleSpy).toHaveBeenNthCalledWith(2, false);
  });

  it('should update live demo key when onLiveKeyChange is called', () => {
    component.onLiveKeyChange('demo-secret-key-123');
    expect(incidentService.liveDemoKey()).toBe('demo-secret-key-123');
  });

  it('should switch languages between PT and EN', () => {
    expect(i18n.currentLang()).toBe(Language.PT_BR);
    component.onLangChange(Language.EN_US);
    expect(i18n.currentLang()).toBe(Language.EN_US);
    expect(i18n.t('simulateIncident')).toBe('💥 Simulate Incident');

    component.onLangChange(Language.PT_BR);
    expect(i18n.currentLang()).toBe(Language.PT_BR);
    expect(i18n.t('simulateIncident')).toBe('💥 Simular Incidente');
  });

  it('should delegate chaos, reset and simulate decision actions to IncidentService', async () => {
    const chaosSpy = vi
      .spyOn(incidentService, 'triggerChaos')
      .mockResolvedValue({ ok: true, status: 200 });
    const resetSpy = vi
      .spyOn(incidentService, 'resetChaos')
      .mockResolvedValue({ ok: true, status: 200 });
    const simSpy = vi
      .spyOn(incidentService, 'simulateDecision')
      .mockResolvedValue({ ok: true, status: 200 });
    const toastSpy = vi.spyOn(component.messageService, 'add');

    await component.onTriggerChaos();
    expect(chaosSpy).toHaveBeenCalled();

    await component.onResetService();
    expect(resetSpy).toHaveBeenCalledWith('', true);

    await component.onSimulateDecision();
    expect(simSpy).toHaveBeenCalledWith('approve');
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: i18n.t('toastDecisionApprovedSummary')
      })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: i18n.t('toastChaosStartedSummary') })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        summary: i18n.t('toastServiceRestoredSummary')
      })
    );
  });

  it('should display error or warning toast on 403, 429 and network errors from demo actions', async () => {
    const toastSpy = vi.spyOn(component.messageService, 'add');

    vi.spyOn(incidentService, 'triggerChaos').mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden: Valid X-Live-Demo-Key required'
    });
    await component.onTriggerChaos();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: i18n.t('toastLiveKeyRequiredSummary')
      })
    );

    vi.spyOn(incidentService, 'triggerChaos').mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: 'Cooldown active',
      errorCode: 'SIMULATION_COOLDOWN',
      retryAfterSeconds: 42
    });
    await component.onTriggerChaos();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: i18n.t('toastCooldownSummary'),
        detail: i18n.t('toastCooldownDetailWithSeconds').replace('{N}', '42')
      })
    );

    vi.spyOn(incidentService, 'resetChaos').mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: 'Too many requests',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 15
    });
    await component.onResetService();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: i18n.t('toastRateLimitSummary'),
        detail: i18n.t('toastRateLimitDetailWithSeconds').replace('{N}', '15')
      })
    );

    vi.spyOn(incidentService, 'resetChaos').mockResolvedValueOnce({
      ok: false,
      error: 'Network failure'
    });
    await component.onResetService();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: i18n.t('toastActionErrorSummary'),
        detail: i18n.t('toastActionErrorDetail')
      })
    );
  });

  it('should compute evidence coverage and reasoning source correctly when incident is set', () => {
    incidentService.currentIncident.set(JSON.parse(JSON.stringify(MOCK_INCIDENT)));
    expect(incidentService.evidenceCoveragePercent()).toBe(100);
    expect(incidentService.signalsRatio()).toBe('4/4');
    expect(incidentService.reasoningSource()).toBe('llm');
    expect(incidentService.isPiiPassed()).toBe(true);
    expect(incidentService.timelineSteps()).toHaveLength(8);
  });

  it('should compose pure header, notices, timeline, telemetry, and KPIs as decoupled siblings', () => {
    const html = readFileSync(WAR_ROOM_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('<p-toast position="bottom-center" class="war-room-toast" />');
    expect(html).toContain('<app-war-room-header');
    expect(html).toContain('sticky top-0');
    expect(html).toContain('<app-war-room-notices');
    expect(html).toContain('<app-war-room-kpis');
    expect(html).not.toContain('</app-war-room-header>');
  });
});
