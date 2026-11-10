export function truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
  const boundedLines = lines.slice(0, maxLines);
  return boundedLines.map((line) => {
    if (line.length <= maxChars) {
      return line;
    }
    return `${line.slice(0, maxChars)}...`;
  });
}

export function truncateDiff(diff: string, maxChars = 1500): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return `${diff.slice(0, maxChars)}\n... [TRUNCATED_DIFF]`;
}

export function sanitizeCommitMessage(message: string): string {
  if (!message) return '';
  return message
    .split('\n')
    .filter((line) => !/^\s*co-authored-by\s*:/i.test(line))
    .join('\n')
    .trim();
}

export function sanitizeAuthorLogin(
  author: { login?: string; name?: string; email?: string } | string | null | undefined
): string {
  if (!author) return 'unknown';
  if (typeof author === 'string') return author.trim();
  if (author.login && typeof author.login === 'string') return author.login.trim();
  if (author.name && typeof author.name === 'string') return author.name.trim();
  return 'unknown';
}

export class LogTruncator {
  static truncateLines(lines: string[], maxLines = 100, maxChars = 500): string[] {
    return truncateLines(lines, maxLines, maxChars);
  }

  static truncateDiff(diff: string, maxChars = 1500): string {
    return truncateDiff(diff, maxChars);
  }
}
