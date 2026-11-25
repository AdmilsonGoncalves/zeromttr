import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { GitDiffFinopsTabComponent } from '../src/app/war-room/evidence-panel/git-diff-finops-tab/git-diff-finops-tab.component.js';

describe('GitDiffFinopsTabComponent', () => {
  let i18n: I18nService;
  let component: GitDiffFinopsTabComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new GitDiffFinopsTabComponent(i18n);
    component.finopsReduction = 84;
    component.estimatedTokensSaved = 10122;
  });

  it('should_expose_mock_git_diff_and_finops_signals', () => {
    component.incident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 100');
    expect(component.mockGitDiff).toContain('acquireTimeoutMillis: 5000');
    expect(component.finopsReductionSignal()).toBe(84);
    expect(component.estimatedTokensSavedSignal()).toBe(10122);
    expect(component.finopsCompactedBarPercent()).toBeGreaterThan(0);
    expect(component.finopsCompactedBarPercent()).toBeLessThan(100);
  });
});
