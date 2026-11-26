import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { WarRoomNoticesComponent } from '../src/app/war-room/war-room-notices/war-room-notices.component.js';

describe('WarRoomNoticesComponent', () => {
  let i18n: I18nService;
  let component: WarRoomNoticesComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomNoticesComponent(i18n);
  });

  it('should_reflect_replay_mode_and_turnstile_lock_inputs_in_reactive_signals', () => {
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

  it('should_safely_ignore_retryTurnstileLoad_when_host_element_or_site_key_is_missing', () => {
    component.turnstileLoadErrorSignal.set(true);
    component.retryTurnstileLoad();
    expect(component.turnstileLoadErrorSignal()).toBe(true);
  });

  it('should_emit_null_on_turnstileTokenChange_and_prevent_post_destroy_script_mounts_during_ngOnDestroy', () => {
    const spy = vi.fn();
    component.turnstileTokenChange.subscribe(spy);
    component.ngOnDestroy();
    expect(spy).toHaveBeenCalledWith(null);
  });
});
