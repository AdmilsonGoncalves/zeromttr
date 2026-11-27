import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { WarRoomNoticesComponent } from '../src/app/war-room/war-room-notices/war-room-notices.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOTICES_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/war-room-notices/war-room-notices.component.html'
);

describe('WarRoomNoticesComponent', () => {
  let i18n: I18nService;
  let component: WarRoomNoticesComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomNoticesComponent(i18n);
  });

  it('should reflect turnstile inputs in reactive signals without rendering replay banner', () => {
    expect(component.turnstileSiteKeySignal()).toBeNull();
    expect(component.simulationLockedByTurnstileSignal()).toBe(false);

    component.turnstileSiteKey = '0x4AAAAAA';
    component.simulationLockedByTurnstile = true;

    expect(component.turnstileSiteKeySignal()).toBe('0x4AAAAAA');
    expect(component.simulationLockedByTurnstileSignal()).toBe(true);

    const html = readFileSync(NOTICES_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('replayNotice');
    expect(html).toContain('turnstileSiteKeySignal()');
  });

  it('should safely ignore retryTurnstileLoad when host element or site key is missing', () => {
    component.turnstileLoadErrorSignal.set(true);
    component.retryTurnstileLoad();
    expect(component.turnstileLoadErrorSignal()).toBe(true);
  });

  it('should emit null on turnstileTokenChange and prevent post-destroy script mounts during ngOnDestroy', () => {
    const spy = vi.fn();
    component.turnstileTokenChange.subscribe(spy);
    component.ngOnDestroy();
    expect(spy).toHaveBeenCalledWith(null);
  });
});
