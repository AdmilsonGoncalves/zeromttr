import { Injectable, computed, signal } from '@angular/core';
import { EN_TRANSLATIONS } from './en.translations.js';
import { ES_TRANSLATIONS } from './es.translations.js';
import { Language, type TranslationDictionary } from './i18n.types.js';
import { PT_TRANSLATIONS } from './pt.translations.js';

export { Language } from './i18n.types.js';
export type { TranslationDictionary } from './i18n.types.js';

export const LOCALE_STORAGE_KEY = 'locale';

const SUPPORTED_LANGUAGES = new Set<string>(Object.values(Language));

const TRANSLATION_BY_LANG: Record<Language, TranslationDictionary> = {
  [Language.PT_BR]: PT_TRANSLATIONS,
  [Language.EN_US]: EN_TRANSLATIONS,
  [Language.ES_ES]: ES_TRANSLATIONS
};

function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.has(value);
}

/**
 * Signal-based internationalization service switching dashboard copy across Portuguese, English, and Spanish
 * with safe `localStorage` persistence (`locale`) and `<html lang>` synchronization.
 */
@Injectable({
  providedIn: 'root'
})
export class I18nService {
  readonly currentLang = signal<Language>(this.readPersistedLanguage());

  readonly dict = computed<TranslationDictionary>(() => {
    return TRANSLATION_BY_LANG[this.currentLang()] ?? PT_TRANSLATIONS;
  });

  constructor() {
    this.syncDocumentLang(this.currentLang());
  }

  /**
   * Switches the active UI language signal, persists it under `localStorage['locale']`,
   * and updates `<html lang="...">`.
   */
  setLang(lang: Language): void {
    if (!isSupportedLanguage(lang)) {
      return;
    }
    this.currentLang.set(lang);
    this.persistLanguage(lang);
    this.syncDocumentLang(lang);
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

  private readPersistedLanguage(): Language {
    try {
      const storage = globalThis.localStorage;
      if (storage && typeof storage.getItem === 'function') {
        const stored = storage.getItem(LOCALE_STORAGE_KEY);
        if (isSupportedLanguage(stored)) {
          return stored;
        }
      }
    } catch {
      // Ignore storage access errors in SSR, private browsing, or non-browser environments
    }
    return Language.PT_BR;
  }

  private persistLanguage(lang: Language): void {
    try {
      const storage = globalThis.localStorage;
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(LOCALE_STORAGE_KEY, lang);
      }
    } catch {
      // Ignore storage write errors (quota exceeded or restricted storage)
    }
  }

  private syncDocumentLang(lang: Language): void {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = lang;
      }
    } catch {
      // Ignore DOM access errors in non-browser environments
    }
  }
}
