import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { TraceTreeTabComponent } from '../src/app/war-room/evidence-panel/trace-tree-tab/trace-tree-tab.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACE_TREE_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/evidence-panel/trace-tree-tab/trace-tree-tab.component.html'
);

describe('TraceTreeTabComponent', () => {
  let i18n: I18nService;
  let component: TraceTreeTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new TraceTreeTabComponent(i18n);
    component.signalsRatio = '4/4';
    component.evidenceCoveragePercent = 100;
  });

  it('should_store_incident_and_evidence_coverage_signals', () => {
    component.incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    expect(component.signalsRatioSignal()).toBe('4/4');
    expect(component.evidenceCoveragePercentSignal()).toBe(100);
    expect(component.incidentSignal()?.rca?.traceId).toBe(MOCK_INCIDENT.rca?.traceId);
  });

  it('should_render_idle_and_awaiting_span_empty_states_without_blank_trace_id', () => {
    const html = readFileSync(TRACE_TREE_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('@if (incidentSignal()?.rca?.traceId; as traceId)');
    expect(html).toContain("i18n.t('traceTreeIdleBody')");
    expect(html).toContain("i18n.t('traceTreeAwaitingBody')");
  });
});
