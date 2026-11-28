import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  I18nService,
  LOCALE_STORAGE_KEY,
  Language
} from '../../../src/app/core/i18n/i18n.service.js';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    }
  };
}

describe('I18nService', () => {
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

  function stubLocalStorage(value: unknown): void {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value
    });
  }

  function stubDocumentLang(initialLang = 'pt-BR'): { documentElement: { lang: string } } {
    const fakeDocument = { documentElement: { lang: initialLang } };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: fakeDocument
    });
    return fakeDocument;
  }

  afterEach(() => {
    if (originalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }

    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    } else {
      delete (globalThis as { document?: unknown }).document;
    }

    vi.restoreAllMocks();
  });

  it('should default to Portuguese translations', () => {
    const service = new I18nService();
    expect(service.currentLang()).toBe(Language.PT_BR);
    expect(service.t('liveMode')).toContain('Live API Mode');
    expect(service.t('simulateIncident')).toContain('Simular Incidente');
    expect(service.t('reasoningSourceLlm')).toBe('Gemini LLM');
  });

  it('should switch dynamically to English when setLang(Language.EN_US) is called', () => {
    const service = new I18nService();
    service.setLang(Language.EN_US);
    expect(service.currentLang()).toBe(Language.EN_US);
    expect(service.t('simulateIncident')).toBe('💥 Simulate Incident');
    expect(service.t('tabTraceTree')).toBe('Trace Tree & Evidence');
    expect(service.t('restoreService')).toBe('🔄 Restore Service');
  });

  it('should switch back to Portuguese without loss of keys', () => {
    const service = new I18nService();
    service.setLang(Language.EN_US);
    expect(service.t('healthy')).toBe('Healthy');
    service.setLang(Language.ES_ES);
    expect(service.t('healthy')).toBe('Saludable');
    expect(service.t('simulateIncident')).toBe('💥 Simular Incidente');
    service.setLang(Language.PT_BR);
    expect(service.t('healthy')).toBe('Saudável');
  });

  it('should contain all required keys in PT, EN, and ES dictionaries', () => {
    const service = new I18nService();
    service.setLang(Language.PT_BR);
    const ptDict = service.dict();
    service.setLang(Language.EN_US);
    const enDict = service.dict();
    service.setLang(Language.ES_ES);
    const esDict = service.dict();

    const ptKeys = Object.keys(ptDict) as (keyof typeof ptDict)[];
    const enKeys = Object.keys(enDict) as (keyof typeof enDict)[];
    const esKeys = Object.keys(esDict) as (keyof typeof esDict)[];

    expect(ptKeys.sort()).toEqual(enKeys.sort());
    expect(ptKeys.sort()).toEqual(esKeys.sort());
    for (const key of ptKeys) {
      expect(ptDict[key]).toBeTruthy();
      expect(enDict[key]).toBeTruthy();
      expect(esDict[key]).toBeTruthy();
    }
  });

  it('should_exclude_removed_chart_gauge_and_bar_keys_from_dictionaries', () => {
    const service = new I18nService();
    const removedKeys = [
      'chartPoolGaugeLabel',
      'chartFinopsGaugeLabel',
      'chartMttrBarsTitle',
      'chartSloThreshold'
    ];
    for (const lang of [Language.PT_BR, Language.EN_US, Language.ES_ES]) {
      service.setLang(lang);
      const keys = Object.keys(service.dict());
      for (const removed of removedKeys) {
        expect(keys).not.toContain(removed);
      }
    }
  });

  it('should provide neutral idle copy without simulation jargon and interpolate service name', () => {
    const service = new I18nService();

    service.setLang(Language.PT_BR);
    expect(service.t('piiIdleBadge')).toBe('Nenhum incidente ativo');
    expect(service.t('tooltipHealthyTraffic', { service: 'orders-api' })).toContain('orders-api');
    expect(service.t('tooltipHealthyTraffic', { service: 'orders-api' })).not.toContain(
      'api-pagamentos-core'
    );

    service.setLang(Language.EN_US);
    expect(service.t('piiIdleBadge')).toBe('No active incident');
    expect(service.t('toastHealthyTrafficStartedDetail', { service: 'orders-api' })).toContain(
      'orders-api'
    );

    service.setLang(Language.ES_ES);
    expect(service.t('piiIdleBadge')).toBe('Ningún incidente activo');
    expect(service.t('tooltipHealthyTraffic', { service: 'orders-api' })).toContain('orders-api');

    for (const lang of [Language.PT_BR, Language.EN_US, Language.ES_ES]) {
      service.setLang(lang);
      expect(service.dict().tooltipHealthyTraffic).not.toContain('api-pagamentos-core');
      expect(service.dict().toastHealthyTrafficStartedDetail).not.toContain('api-pagamentos-core');
      expect(service.dict().traceTreeIdleBody.toLowerCase()).not.toMatch(/simula/);
      expect(service.dict().gitDiffIdleBody.toLowerCase()).not.toMatch(/simula/);
      expect(service.dict().resendIdleBody.toLowerCase()).not.toMatch(/simula/);
    }
  });

  it('should_insert_dollar_replacement_tokens_literally_during_param_interpolation', () => {
    const service = new I18nService();
    const interpolated = service.t('tooltipHealthyTraffic', { service: 'svc-$&-$$-$`' });
    expect(interpolated).toContain('svc-$&-$$-$`');
  });

  it('should_use_neutral_resolved_and_approval_wording_without_claiming_target_restoration', () => {
    const service = new I18nService();
    for (const lang of [Language.PT_BR, Language.EN_US, Language.ES_ES]) {
      service.setLang(lang);
      expect(service.t('fsmHintResolved').toLowerCase()).not.toMatch(/restaur|restor/);
      expect(service.t('toastDecisionApprovedDetail').toLowerCase()).not.toMatch(/restaur|restor/);
    }
  });

  it('should_persist_selected_locale_in_localStorage_and_sync_html_lang', () => {
    expect(LOCALE_STORAGE_KEY).toBe('zeromttr_locale');
    const storage = createMemoryStorage();
    stubLocalStorage(storage);
    const fakeDocument = stubDocumentLang('pt-BR');

    const service = new I18nService();
    expect(service.currentLang()).toBe(Language.PT_BR);
    expect(fakeDocument.documentElement.lang).toBe(Language.PT_BR);

    service.setLang(Language.EN_US);
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe(Language.EN_US);
    expect(fakeDocument.documentElement.lang).toBe(Language.EN_US);

    service.setLang(Language.ES_ES);
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe(Language.ES_ES);
    expect(fakeDocument.documentElement.lang).toBe(Language.ES_ES);
  });

  it.each([Language.PT_BR, Language.EN_US, Language.ES_ES])(
    'should_restore_persisted_locale_%s_on_construction_and_sync_html_lang',
    (savedLang) => {
      stubLocalStorage(createMemoryStorage({ [LOCALE_STORAGE_KEY]: savedLang }));
      const fakeDocument = stubDocumentLang('pt-BR');

      const service = new I18nService();
      expect(service.currentLang()).toBe(savedLang);
      expect(fakeDocument.documentElement.lang).toBe(savedLang);
    }
  );

  it.each(['fr-FR', 'pt', '', '   ', 'invalid-locale'])(
    'should_fallback_safely_to_pt_BR_when_persisted_locale_%j_is_invalid',
    (invalidLocale) => {
      stubLocalStorage(createMemoryStorage({ [LOCALE_STORAGE_KEY]: invalidLocale }));
      const fakeDocument = stubDocumentLang('en-US');

      const service = new I18nService();
      expect(service.currentLang()).toBe(Language.PT_BR);
      expect(fakeDocument.documentElement.lang).toBe(Language.PT_BR);
    }
  );

  it('should_ignore_unsupported_values_passed_to_setLang_without_mutating_storage', () => {
    const storage = createMemoryStorage({ [LOCALE_STORAGE_KEY]: Language.EN_US });
    stubLocalStorage(storage);
    const fakeDocument = stubDocumentLang(Language.EN_US);

    const service = new I18nService();
    service.setLang('fr-FR' as Language);

    expect(service.currentLang()).toBe(Language.EN_US);
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe(Language.EN_US);
    expect(fakeDocument.documentElement.lang).toBe(Language.EN_US);
  });

  it('should_degrade_gracefully_when_localStorage_is_unavailable_or_throws', () => {
    stubLocalStorage(undefined);
    const withoutStorage = new I18nService();
    expect(withoutStorage.currentLang()).toBe(Language.PT_BR);
    expect(() => withoutStorage.setLang(Language.ES_ES)).not.toThrow();
    expect(withoutStorage.currentLang()).toBe(Language.ES_ES);

    stubLocalStorage({
      getItem: () => {
        throw new Error('SecurityError: storage disabled');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    });
    const throwingStorage = new I18nService();
    expect(throwingStorage.currentLang()).toBe(Language.PT_BR);
    expect(() => throwingStorage.setLang(Language.EN_US)).not.toThrow();
    expect(throwingStorage.currentLang()).toBe(Language.EN_US);
  });
});
