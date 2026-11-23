import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { WarRoomHeaderComponent } from '../src/app/war-room/war-room-header/war-room-header.component.js';

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
});
