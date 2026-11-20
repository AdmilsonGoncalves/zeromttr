import { isNonEmptyString } from '@zeromttr/utils';

/**
 * Resolves the canonical repository HTTPS URL from `TARGET_REPO_URL` or `TARGET_GITHUB_REPO`.
 */
export function resolveTargetRepoUrl(
  env: Record<string, string | undefined> = process.env
): string {
  if (isNonEmptyString(env.TARGET_REPO_URL)) {
    return env.TARGET_REPO_URL.trim().replace(/\/+$/, '');
  }

  const githubRepo = env.TARGET_GITHUB_REPO;
  if (!isNonEmptyString(githubRepo)) {
    return '';
  }

  const trimmed = githubRepo
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const slug = trimmed.replace(/^\/+/, '');
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
    return `https://github.com/${slug}`;
  }

  return '';
}
