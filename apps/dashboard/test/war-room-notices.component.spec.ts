import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { WarRoomNoticesComponent } from '../src/app/war-room/war-room-notices/war-room-notices.component.js';

describe('WarRoomNoticesComponent', () => {
  let i18n: I18nService;
  let component: WarRoomNoticesComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomNoticesComponent(i18n);
  });

  it('should reflect replay mode and turnstile lock inputs in reactive signals', () => {
    expect(component.activeModeSignal()).toBe(IncidentExecutionMode.REPLAY);
    expect(component.turnstileSiteKeySignal()).toBeNull();
    expect(component.simulationLockedByTurnstileSignal()).toBe(false);

    component.activeMode = IncidentExecutionMode.LIVE;
    component.turnstileSiteKey = '0x4AAAAAA';
    component.simulationLockedByTurnstile = true;

    expect(component.activeModeSignal()).toBe(IncidentExecutionMode.LIVE);
    expect(component.turnstileSiteKeySignal()).toBe('0x4AAAAAA');
    expect(component.simulationLockedByTurnstileSignal()).toBe(true);
  });

  it('should safely ignore retryTurnstileLoad when host element or site key is missing', () => {
    component.turnstileLoadErrorSignal.set(true);
    component.retryTurnstileLoad();
    expect(component.turnstileLoadErrorSignal()).toBe(true);
  });

  it('should emit turnstileTokenChange reset cleanly when ngOnDestroy runs without global turnstile', () => {
    const spy = vi.fn();
    component.turnstileTokenChange.subscribe(spy);
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
