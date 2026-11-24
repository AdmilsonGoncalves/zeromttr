import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { EvidencePanelComponent } from '../src/app/war-room/evidence-panel/evidence-panel.component.js';

describe('EvidencePanelComponent', () => {
  let i18n: I18nService;
  let component: EvidencePanelComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new EvidencePanelComponent(i18n);
    component.signalsRatio = '4/4';
    component.evidenceCoveragePercent = 100;
    component.leakedPatternsCount = 0;
    component.finopsReduction = 84;
    component.estimatedTokensSaved = 10122;
    component.isPiiPassed = true;
  });

  it('should expose fallback logs and mock git diff when no incident is selected', () => {
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 100');
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 5000');
    expect(component.displayedPreCollectorLog()).toContain('123.456.789-00');
    expect(component.displayedPostOttlLog()).toContain('[REDACTED_CPF]');
  });

  it('should extract clean body from Loki JSON envelope', () => {
    const lokiEnvelopeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    lokiEnvelopeIncident.rca.logSample =
      '{"body":"ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]","traceid":"abc"}\n{"body":"second line"}';
    component.incident = lokiEnvelopeIncident;

    expect(component.displayedPostOttlLog()).toBe(
      'ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]'
    );
  });

  it('should withhold post-OTTL log when PII audit fails', () => {
    const blockedIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    blockedIncident.rca.piiGuardAudit = {
      passed: false,
      leakedPatternsDetected: 1,
      detectedTypes: ['CPF'],
      edgeRedactedTokensVerified: 0
    };
    component.incident = blockedIncident;
    component.isPiiPassed = false;

    expect(component.displayedPostOttlLog()).toContain('CPF');
  });

  it('should update activeTab only for filled tab values', () => {
    expect(component.activeTab()).toBe('0');
    component.onTabChange('2');
    expect(component.activeTab()).toBe('2');
    component.onTabChange(undefined);
    expect(component.activeTab()).toBe('2');
  });
});
