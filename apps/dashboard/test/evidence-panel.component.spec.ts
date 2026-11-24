import '@angular/compiler';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../src/app/core/i18n.service.js';
import { EvidencePanelComponent } from '../src/app/war-room/evidence-panel/evidence-panel.component.js';

const EVIDENCE_TEMPLATE_PATH = path.resolve(
  import.meta.dirname,
  '../src/app/war-room/evidence-panel/evidence-panel.component.html'
);

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

  it('should_default_activeTab_to_0_and_update_only_for_filled_tab_values', () => {
    expect(component.activeTab()).toBe('0');
    component.onTabChange('1');
    expect(component.activeTab()).toBe('1');
    component.onTabChange('2');
    expect(component.activeTab()).toBe('2');
    component.onTabChange('3');
    expect(component.activeTab()).toBe('3');
    component.onTabChange(undefined);
    expect(component.activeTab()).toBe('3');
  });

  it('should_render_live_metrics_as_tab_1_and_delegate_each_tab_to_its_child_component', () => {
    const html = fs.readFileSync(EVIDENCE_TEMPLATE_PATH, 'utf8');
    const liveTabIdx = html.indexOf("i18n.t('tabLiveMetrics')");
    const traceTabIdx = html.indexOf("i18n.t('tabTraceTree')");
    const lokiTabIdx = html.indexOf("i18n.t('tabLokiLogs')");
    const diffTabIdx = html.indexOf("i18n.t('tabGitDiff')");

    expect(liveTabIdx).toBeGreaterThan(-1);
    expect(liveTabIdx).toBeLessThan(traceTabIdx);
    expect(traceTabIdx).toBeLessThan(lokiTabIdx);
    expect(lokiTabIdx).toBeLessThan(diffTabIdx);

    expect(html).toContain('<app-live-metrics-tab');
    expect(html).toContain('<app-trace-tree-tab');
    expect(html).toContain('<app-loki-pii-tab');
    expect(html).toContain('<app-git-diff-finops-tab');
  });
});
