import { describe, it, expect } from 'vitest';
import { I18nService } from '../src/app/core/i18n.service.js';

describe('I18nService', () => {
  it('should default to Portuguese translations', () => {
    const service = new I18nService();
    expect(service.currentLang()).toBe('pt');
    expect(service.t('liveMode')).toContain('Live API Mode');
    expect(service.t('simulateIncident')).toContain('Simular Incidente');
    expect(service.t('reasoningSourceLlm')).toBe('Gemini LLM');
  });

  it('should switch dynamically to English when setLang("en") is called', () => {
    const service = new I18nService();
    service.setLang('en');
    expect(service.currentLang()).toBe('en');
    expect(service.t('simulateIncident')).toBe('💥 Simulate Incident');
    expect(service.t('tabTraceTree')).toBe('Trace Tree & Evidence');
    expect(service.t('restoreService')).toBe('🔄 Restore Service');
  });

  it('should switch back to Portuguese without loss of keys', () => {
    const service = new I18nService();
    service.setLang('en');
    expect(service.t('healthy')).toBe('Healthy');
    service.setLang('pt');
    expect(service.t('healthy')).toBe('Saudável');
  });

  it('should contain all required keys in both PT and EN dictionaries', () => {
    const service = new I18nService();
    service.setLang('pt');
    const ptDict = service.dict();
    service.setLang('en');
    const enDict = service.dict();

    const ptKeys = Object.keys(ptDict) as (keyof typeof ptDict)[];
    const enKeys = Object.keys(enDict) as (keyof typeof enDict)[];

    expect(ptKeys.sort()).toEqual(enKeys.sort());
    for (const key of ptKeys) {
      expect(ptDict[key]).toBeTruthy();
      expect(enDict[key]).toBeTruthy();
    }
  });
});
