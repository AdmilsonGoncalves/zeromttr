import { describe, it, expect } from 'vitest';
import { resolveTargetRepoUrl } from '../../../src/domain/target-repo-url.js';

describe('resolveTargetRepoUrl', () => {
  it('should prefer explicit TARGET_REPO_URL and trim trailing slashes', () => {
    expect(
      resolveTargetRepoUrl({
        TARGET_REPO_URL: '  https://github.com/example/custom-repo///  ',
        TARGET_GITHUB_REPO: 'example/other-repo'
      })
    ).toBe('https://github.com/example/custom-repo');
  });

  it('should derive GitHub HTTPS URL from owner/repo TARGET_GITHUB_REPO when TARGET_REPO_URL is unset or blank', () => {
    expect(
      resolveTargetRepoUrl({
        TARGET_GITHUB_REPO: 'example/payments'
      })
    ).toBe('https://github.com/example/payments');

    expect(
      resolveTargetRepoUrl({
        TARGET_REPO_URL: '   ',
        TARGET_GITHUB_REPO: ' /example/payments/ '
      })
    ).toBe('https://github.com/example/payments');
  });

  it('should preserve full HTTP(S) TARGET_GITHUB_REPO URL and strip .git suffix', () => {
    expect(
      resolveTargetRepoUrl({
        TARGET_GITHUB_REPO: 'https://github.com/example/payments.git/'
      })
    ).toBe('https://github.com/example/payments');

    expect(
      resolveTargetRepoUrl({
        TARGET_GITHUB_REPO: 'http://git.internal.local/example/payments.git'
      })
    ).toBe('http://git.internal.local/example/payments');
  });

  it('should return empty string when both variables are missing or TARGET_GITHUB_REPO is malformed', () => {
    expect(resolveTargetRepoUrl({})).toBe('');
    expect(
      resolveTargetRepoUrl({
        TARGET_REPO_URL: '',
        TARGET_GITHUB_REPO: 'not-a-valid-repo-slug'
      })
    ).toBe('');
    expect(
      resolveTargetRepoUrl({
        TARGET_GITHUB_REPO: 'a/b/c'
      })
    ).toBe('');
  });
});
