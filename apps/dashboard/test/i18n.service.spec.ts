import { describe, it, expect } from 'vitest';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';

describe('I18nService', () => {
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
});
