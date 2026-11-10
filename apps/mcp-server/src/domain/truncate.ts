import { isEmpty, isNonEmptyString, isString, truncate } from '@zeromttr/utils';

export function truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
  const boundedLines = lines.slice(0, maxLines);
  return boundedLines.map((line) => truncate(line, maxChars));
}

export function truncateDiff(diff: string, maxChars = 1500): string {
  return truncate(diff, maxChars, '\n... [TRUNCATED_DIFF]');
}

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
  static truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
    return truncateLines(lines, maxLines, maxChars);
  }
}
