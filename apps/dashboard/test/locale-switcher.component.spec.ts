import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';
import { LocaleSwitcherComponent } from '../src/app/war-room/locale-switcher/locale-switcher.component.js';

describe('LocaleSwitcherComponent', () => {
  let i18n: I18nService;
  let component: LocaleSwitcherComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new LocaleSwitcherComponent(i18n);
  });

  it('should_expose_pt_br_en_us_and_es_es_locale_options_and_resolve_active_flag', () => {
    expect(component.localeOptions.map((o) => o.code)).toEqual([
      Language.PT_BR,
      Language.EN_US,
      Language.ES_ES
    ]);
    expect(component.activeLocale().flag).toBe('🇧🇷');

    component.currentLang = Language.ES_ES;
    expect(component.activeLocale().label).toBe('Español');
    expect(component.activeLocale().flag).toBe('🇪🇸');
  });

  it('should_toggle_dropdown_state_emit_selected_locale_and_close_menu', () => {
    const spy = vi.fn();
    component.langChange.subscribe(spy);

    expect(component.isOpenSignal()).toBe(false);
    component.toggleMenu();
    expect(component.isOpenSignal()).toBe(true);

    component.selectLocale(Language.ES_ES);
    expect(spy).toHaveBeenCalledWith(Language.ES_ES);
    expect(component.isOpenSignal()).toBe(false);
  });

  it('should_close_dropdown_on_escape_or_tab_keyboard_events', () => {
    component.toggleMenu();
    expect(component.isOpenSignal()).toBe(true);

    component.onMenuKeydown({ key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(component.isOpenSignal()).toBe(false);

    component.toggleMenu();
    component.onMenuKeydown({ key: 'Tab', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(component.isOpenSignal()).toBe(false);
  });
});
