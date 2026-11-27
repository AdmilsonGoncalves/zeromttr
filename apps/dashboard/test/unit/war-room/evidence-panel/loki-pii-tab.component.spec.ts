import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../../../../mock-server/mock-data.js';
import { I18nService } from '../../../../src/app/core/i18n/i18n.service.js';
import { LokiPiiTabComponent } from '../../../../src/app/war-room/evidence-panel/loki-pii-tab/loki-pii-tab.component.js';
import { createWithInjector } from '../../../helpers/di.helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOKI_TAB_TEMPLATE_PATH = resolve(
  HERE,
  '../../../../src/app/war-room/evidence-panel/loki-pii-tab/loki-pii-tab.component.html'
);

describe('LokiPiiTabComponent', () => {
  let i18n: I18nService;
  let component: LokiPiiTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = createWithInjector(LokiPiiTabComponent, [{ provide: I18nService, useValue: i18n }]);
    component.leakedPatternsCount = 0;
    component.isPiiPassed = true;
  });

  it('should_render_idle_logs_and_idle_badge_when_no_incident_is_active', () => {
    expect(component.displayedPreCollectorLog()).toBe(i18n.t('piiIdlePreCollectorLog'));
    expect(component.displayedPostOttlLog()).toBe(i18n.t('piiIdlePostOttlLog'));

    const html = readFileSync(LOKI_TAB_TEMPLATE_PATH, 'utf8');
    expect(html).toContain("i18n.t('piiIdleBadge')");
    expect(html).toContain('@else if (incidentSignal())');
  });

  it('should_expose_fallback_logs_when_active_incident_has_no_rca_logs_yet', () => {
    const partialIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    delete partialIncident.rca;
    component.incident = partialIncident;

    expect(component.displayedPreCollectorLog()).toContain('123.456.789-00');
    expect(component.displayedPostOttlLog()).toContain('[REDACTED_CPF]');

    component.incident = null;
    expect(component.displayedPreCollectorLog()).toBe(i18n.t('piiIdlePreCollectorLog'));
    expect(component.displayedPostOttlLog()).toBe(i18n.t('piiIdlePostOttlLog'));
  });

  it('should_extract_clean_body_from_loki_json_envelope', () => {
    const lokiEnvelopeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    lokiEnvelopeIncident.rca.logSample =
      '{"body":"ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]","traceid":"abc"}\n{"body":"second line"}';
    component.incident = lokiEnvelopeIncident;

    expect(component.displayedPostOttlLog()).toBe(
      'ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]'
    );
  });

  it('should_withhold_post_ottl_log_when_pii_audit_fails', () => {
    const blockedIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    blockedIncident.rca.piiGuardAudit = {
      passed: false,
      leakedPatternsDetected: 1,
      detectedTypes: ['CPF'],
      edgeRedactedTokensVerified: 0
    };
    component.incident = blockedIncident;
    component.isPiiPassed = false;
    component.leakedPatternsCount = 1;

    expect(component.displayedPostOttlLog()).toContain('CPF');
  });
});
