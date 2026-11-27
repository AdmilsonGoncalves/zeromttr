import { Injectable, computed, signal } from '@angular/core';
import { EN_TRANSLATIONS } from './en.translations.js';
import { ES_TRANSLATIONS } from './es.translations.js';
import { Language, type TranslationDictionary } from './i18n.types.js';
import { PT_TRANSLATIONS } from './pt.translations.js';

export { Language } from './i18n.types.js';
export type { TranslationDictionary } from './i18n.types.js';

const TRANSLATION_BY_LANG: Record<Language, TranslationDictionary> = {
  [Language.PT_BR]: PT_TRANSLATIONS,
  [Language.EN_US]: EN_TRANSLATIONS,
  [Language.ES_ES]: ES_TRANSLATIONS
};

/**
 * Signal-based internationalization service switching dashboard copy across Portuguese, English, and Spanish.
 */
@Injectable({
  providedIn: 'root'
})
export class I18nService {
  readonly currentLang = signal<Language>(Language.PT_BR);

  readonly dict = computed<TranslationDictionary>(() => {
    return TRANSLATION_BY_LANG[this.currentLang()] ?? PT_TRANSLATIONS;
  });

  /**
   * Switches the active UI language signal.
   */
  setLang(lang: Language): void {
    this.currentLang.set(lang);
  }

  /**
   * Resolves a localized string for the given translation key and interpolates `{{param}}` placeholders.
   */
  t(key: keyof TranslationDictionary, params?: Record<string, string>): string {
    let text = this.dict()[key];
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replaceAll(`{{${paramKey}}}`, () => paramValue);
      }
    }
    return text;
  }
}
