import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { GitDiffFinopsTabComponent } from '../src/app/war-room/evidence-panel/git-diff-finops-tab/git-diff-finops-tab.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GIT_DIFF_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/evidence-panel/git-diff-finops-tab/git-diff-finops-tab.component.html'
);

describe('GitDiffFinopsTabComponent', () => {
  let i18n: I18nService;
  let component: GitDiffFinopsTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new GitDiffFinopsTabComponent(i18n);
    component.finopsReduction = 84;
    component.estimatedTokensSaved = 10122;
  });

  it('should_expose_zeroed_finops_bytes_and_idle_diff_copy_when_no_incident_is_active', () => {
    component.finopsReduction = 0;
    component.estimatedTokensSaved = 0;

    expect(component.rawBytesFetched()).toBe(0);
    expect(component.compactedBytesSent()).toBe(0);
    expect(component.finopsCompactedBarPercent()).toBe(0);

    const html = readFileSync(GIT_DIFF_TEMPLATE_PATH, 'utf8');
    expect(html).toContain("i18n.t('gitDiffIdleBody')");
    expect(html).not.toContain('48200');
    expect(html).not.toContain('7712');
  });

  it('should_expose_mock_git_diff_and_finops_signals', () => {
    component.incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 100');
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 5000');
    expect(component.rawBytesFetched()).toBe(MOCK_INCIDENT.finops?.rawBytesFetched);
    expect(component.compactedBytesSent()).toBe(MOCK_INCIDENT.finops?.compactedBytesSent);
    expect(component.finopsReductionSignal()).toBe(84);
    expect(component.estimatedTokensSavedSignal()).toBe(10122);
    expect(component.finopsCompactedBarPercent()).toBeGreaterThan(0);
    expect(component.finopsCompactedBarPercent()).toBeLessThan(100);
  });
});
