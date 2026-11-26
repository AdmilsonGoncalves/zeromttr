import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';
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

  it('should emit langChange for valid inputs and ignore empty language', () => {
    const langSpy = vi.fn();
    component.langChange.subscribe(langSpy);

    component.onLangSelect(Language.EN_US);
    expect(langSpy).toHaveBeenCalledWith(Language.EN_US);

    component.onLangSelect('' as unknown as Language);
    expect(langSpy).toHaveBeenCalledTimes(1);
  });

  it('should track demoModeEnabled and requireDemoKey inputs in signals', () => {
    expect(component.demoModeEnabledSignal()).toBe(false);
    expect(component.requireDemoKeySignal()).toBe(true);

    component.demoModeEnabled = true;
    component.requireDemoKey = false;

    expect(component.demoModeEnabledSignal()).toBe(true);
    expect(component.requireDemoKeySignal()).toBe(false);
  });

  it('should toggle responsive mobile command menu state', () => {
    expect(component.isMobileMenuOpenSignal()).toBe(false);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(true);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(false);
  });

  it('should delegate command controls to app-main-menu and keep header pure', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('<ng-content');
    expect(html).not.toContain('finopsPayloadReduction');
    expect(html).not.toContain('kpiTtdLabel');
    expect(html).not.toContain('turnstileContainer');
    expect(html).toContain('headerMenuBtn');
    expect(html).toContain('aria-controls="war-room-header-menu"');
    expect(html).toContain('<app-main-menu');
    expect(html).toContain('<app-locale-switcher');
    expect(html).not.toContain('<p-selectbutton');
    expect(html).not.toContain('liveKeyPlaceholder');
    expect(html).not.toContain('langOptions');
  });
});
