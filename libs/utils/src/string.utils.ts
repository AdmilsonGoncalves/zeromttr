/**
 * Checks if a value is of type string.
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Checks if a value is a string with at least one non-whitespace character.
 */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

/**
 * Capitalizes the first character of a string and lowercases the remainder.
 */
export function capitalize(str: string): string {
  if (!str) {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Truncates a string to a maximum character length, appending a suffix if truncated.
 */
export function truncate(str: string, maxChars: number, suffix = '...'): string {
  if (str.length <= maxChars) {
    return str;
  }
  return `${str.slice(0, maxChars)}${suffix}`;
}

/**
 * Normalizes all whitespace (tabs, newlines, multiple spaces) into single spaces and trims.
 */
export function sanitizeWhitespace(str: string): string {
  if (!str) {
    return '';
  }
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Escapes characters with special meaning in HTML (&, <, >, ", ').
 */
export function escapeHtml(unsafe: string): string {
  if (!unsafe) {
    return '';
  }
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function decodeHtmlEntitiesForUriCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

/**
 * Strips dangerous tags, inline event handlers, and executable URIs from HTML fragments.
 */
export function stripUnsafeHtml(html: string): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<(script|iframe|object|embed|svg|math|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|svg|math|meta|base)\b[^>]*\/?>/gi, '')
    .replace(/([\s/]+)on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '$1')
    .replace(
      /(\b(?:href|src|action|formaction)\s*=\s*)(["'])([^"']*)\2/gi,
      (full, prefix, q, uri) => {
        const decoded = Array.from(decodeHtmlEntitiesForUriCheck(uri))
          .filter((ch) => ch.charCodeAt(0) > 0x20)
          .join('');
        if (/^(?:javascript|vbscript):/i.test(decoded) || /^data:text\/html/i.test(decoded)) {
          return `${prefix}${q}blocked:${q}`;
        }
        return full;
      }
    )
    .replace(/(?:javascript|vbscript)\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:text/html');
}

/**
 * Validates that a file path is repository-relative and safe from directory traversal.
 * Rejects leading slashes, backslashes, empty paths, and '.' or '..' segments.
 */
export function isSafeRelativePath(filePath: string): boolean {
  if (!isNonEmptyString(filePath)) {
    return false;
  }
  if (filePath.startsWith('/') || filePath.includes('\\')) {
    return false;
  }
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((seg) => seg === '.' || seg === '..')) {
    return false;
  }
  return true;
}
