import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { WarRoomKpisComponent } from '../src/app/war-room/war-room-kpis/war-room-kpis.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KPIS_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/war-room-kpis/war-room-kpis.component.html'
);

describe('WarRoomKpisComponent', () => {
  let i18n: I18nService;
  let component: WarRoomKpisComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomKpisComponent(i18n);
  });

  it('should_expose_ttd_ttpr_evidence_coverage_reasoning_source_and_finops_signals', () => {
    component.ttdDisplay = '2.4s';
    component.ttprDisplay = '8.1s';
    component.signalsRatio = '4/4';
    component.evidenceCoveragePercent = 100;
    component.reasoningSource = 'llm';
    component.finopsReduction = 66.1;
    component.estimatedTokensSaved = 5014;

    expect(component.ttdDisplaySignal()).toBe('2.4s');
    expect(component.ttprDisplaySignal()).toBe('8.1s');
    expect(component.signalsRatioSignal()).toBe('4/4');
    expect(component.evidenceCoveragePercentSignal()).toBe(100);
    expect(component.reasoningSourceSignal()).toBe('llm');
    expect(component.finopsReductionSignal()).toBe(66.1);
    expect(component.estimatedTokensSavedSignal()).toBe(5014);
  });

  it('should_render_all_5_decoupled_kpi_cards_including_finops_payload_reduction', () => {
    const html = readFileSync(KPIS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('kpiTtdLabel');
    expect(html).toContain('kpiTtprLabel');
    expect(html).toContain('evidenceCoverageLabel');
    expect(html).toContain('reasoningSourceLabel');
    expect(html).toContain('finopsPayloadReduction');
  });
});
