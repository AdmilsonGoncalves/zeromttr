import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarRoomComponent } from '../src/app/war-room/war-room.component.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { IncidentService } from '../src/app/core/incident.service.js';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WAR_ROOM_TEMPLATE_PATH = resolve(HERE, '../src/app/war-room/war-room.component.html');

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

    // Instantiate component manually using Angular dependencies
    component = new WarRoomComponent(i18n, incidentService);
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

  it('should toggle active mode between live and replay', () => {
    expect(incidentService.activeMode()).toBe('replay');
    component.onModeChange('live');
    expect(incidentService.activeMode()).toBe('live');
    component.onModeChange('replay');
    expect(incidentService.activeMode()).toBe('replay');
  });

  it('should update live demo key when onLiveKeyChange is called', () => {
    component.onLiveKeyChange('demo-secret-key-123');
    expect(incidentService.liveDemoKey()).toBe('demo-secret-key-123');
  });

  it('should switch languages between PT and EN', () => {
    expect(i18n.currentLang()).toBe('pt');
    component.onLangChange('en');
    expect(i18n.currentLang()).toBe('en');
    expect(i18n.t('simulateIncident')).toBe('💥 Simulate Incident');

    component.onLangChange('pt');
    expect(i18n.currentLang()).toBe('pt');
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
    expect(html).toContain('<app-war-room-header');
    expect(html).toContain('<app-war-room-notices');
    expect(html).toContain('<app-war-room-kpis');
    expect(html).not.toContain('</app-war-room-header>');
  });
});
