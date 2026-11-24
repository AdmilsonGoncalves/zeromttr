import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode, TargetHealthStatus } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { WarRoomHeaderComponent } from '../src/app/war-room/war-room-header/war-room-header.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADER_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/war-room-header/war-room-header.component.html'
);

describe('WarRoomHeaderComponent', () => {
  let i18n: I18nService;
  let component: WarRoomHeaderComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomHeaderComponent(i18n);
  });

  it('should emit modeChange, liveKeyChange and langChange for valid inputs', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const langSpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);
    component.langChange.subscribe(langSpy);

    component.onModeSelect(IncidentExecutionMode.LIVE);
    component.onLiveKeyInput({ target: { value: 'secret-key' } } as unknown as Event);
    component.onLangSelect('en');

    expect(modeSpy).toHaveBeenCalledWith(IncidentExecutionMode.LIVE);
    expect(keySpy).toHaveBeenCalledWith('secret-key');
    expect(langSpy).toHaveBeenCalledWith('en');
  });

  it('should ignore empty mode, language, or missing input target', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const langSpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);
    component.langChange.subscribe(langSpy);

    component.onModeSelect('' as unknown as typeof IncidentExecutionMode.LIVE);
    component.onLiveKeyInput({ target: null } as unknown as Event);
    component.onLangSelect('' as unknown as 'pt');

    expect(modeSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
    expect(langSpy).not.toHaveBeenCalled();
  });

  it('should block starting healthy traffic while target is degraded unless traffic is already active', () => {
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);

    component.targetStatus = {
      status: TargetHealthStatus.DEGRADED,
      service: 'api-pagamentos-core',
      version: 'v2.14.8',
      previousHealthyVersion: 'v2.14.7',
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(true);

    component.healthyTrafficActive = true;
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);

    component.healthyTrafficActive = false;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);
  });

  it('should toggle responsive mobile command menu state', () => {
    expect(component.isMobileMenuOpenSignal()).toBe(false);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(true);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(false);
  });

  it('should remain a pure header template without KPI strips, FinOps badges, notices, or ng-content', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('<ng-content');
    expect(html).not.toContain('finopsPayloadReduction');
    expect(html).not.toContain('kpiTtdLabel');
    expect(html).not.toContain('turnstileContainer');
    expect(html).toContain('headerMenuBtn');
    expect(html).toContain('aria-controls="war-room-header-menu"');
  });
});
