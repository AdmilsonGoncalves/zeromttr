import { isEmpty, isNonEmptyString, isString, truncate } from '@zeromttr/utils';

/**
 * Bounds log output to a maximum number of lines and characters per line.
 */
export function truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
  const boundedLines = lines.slice(0, maxLines);
  return boundedLines.map((line) => truncate(line, maxChars));
}

/**
 * Truncates a code diff string to a character limit with an explicit marker.
 */
export function truncateDiff(diff: string, maxChars = 1500): string {
  return truncate(diff, maxChars, '\n... [TRUNCATED_DIFF]');
}

/**
 * Strips `Co-authored-by` trailer lines from commit messages before sending context to LLMs.
 */
export function sanitizeCommitMessage(message: string): string {
  if (!message) {
    return '';
  }
  return message
    .split('\n')
    .filter((line) => !/^\s*co-authored-by\s*:/i.test(line))
    .join('\n')
    .trim();
}

/**
 * Extracts a safe author login or display name without exposing email addresses.
 */
export function sanitizeAuthorLogin(
  author: { login?: string; name?: string; email?: string } | string | null | undefined
): string {
  if (isEmpty(author)) {
    return 'unknown';
  }
  if (isString(author)) {
    return author.trim();
  }
  if (isNonEmptyString(author.login)) {
    return author.login.trim();
  }
  if (isNonEmptyString(author.name)) {
    return author.name.trim();
  }
  return 'unknown';
}

export class LogTruncator {
  /**
   * Truncates log lines to bounded count and line length limits.
   */
  static truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
    return truncateLines(lines, maxLines, maxChars);
  }
}
