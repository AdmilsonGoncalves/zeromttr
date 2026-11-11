import '@angular/compiler';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarRoomComponent } from '../src/app/war-room/war-room.component.js';
import { I18nService, IncidentService } from '../src/app/core/index.js';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';

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
    vi.spyOn(incidentService, 'fetchTargetStatus').mockImplementation(async () => {});
    vi.spyOn(incidentService, 'fetchIncidents').mockImplementation(async () => {});

    // Instantiate component manually using Angular dependencies
    component = new WarRoomComponent(i18n, incidentService);
  });

  it('should initialize and connect SSE on ngOnInit', () => {
    component.ngOnInit();
    expect(incidentService.connectSse).toHaveBeenCalled();
    expect(incidentService.fetchTargetStatus).toHaveBeenCalled();
    expect(incidentService.fetchIncidents).toHaveBeenCalled();
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

  it('should update live demo key on input event', () => {
    const inputEvent = {
      target: { value: 'demo-secret-key-123' }
    } as unknown as Event;

    component.onLiveKeyInput(inputEvent);
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

  it('should expose mock git diff and logs for tabs 2 and 3', () => {
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 100');
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 5000');
    expect(component.rawPreCollectorLog).toContain('123.456.789-00');
    expect(component.maskedPostOttlLog).toContain('[REDACTED_CPF]');
  });

  it('should delegate chaos, reset and simulate decision actions to IncidentService', () => {
    const chaosSpy = vi.spyOn(incidentService, 'triggerChaos').mockImplementation(async () => {});
    const resetSpy = vi.spyOn(incidentService, 'resetChaos').mockImplementation(async () => {});
    const simSpy = vi.spyOn(incidentService, 'simulateDecision').mockImplementation(async () => {});

    component.onTriggerChaos();
    expect(chaosSpy).toHaveBeenCalled();

    component.onResetService();
    expect(resetSpy).toHaveBeenCalled();

    component.onSimulateDecision();
    expect(simSpy).toHaveBeenCalledWith('approve');
  });

  it('should compute evidence coverage and reasoning source correctly when incident is set', () => {
    incidentService.currentIncident.set(JSON.parse(JSON.stringify(MOCK_INCIDENT)));
    expect(incidentService.evidenceCoveragePercent()).toBe(100);
    expect(incidentService.signalsRatio()).toBe('4/4');
    expect(incidentService.reasoningSource()).toBe('llm');
    expect(incidentService.isPiiPassed()).toBe(true);
    expect(incidentService.timelineSteps()).toHaveLength(8);
  });

  it('should sanitize resend preview HTML safely', () => {
    expect(component.safeResendPreview()).toContain('🚨 ZeroMTTR Incident Post-Mortem');

    incidentService.currentIncident.set(JSON.parse(JSON.stringify(MOCK_INCIDENT)));
    expect(component.safeResendPreview()).toBeDefined();
  });
});
