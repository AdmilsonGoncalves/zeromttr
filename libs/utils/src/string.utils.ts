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

function codePointToChar(codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return '\uFFFD';
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntitiesForUriCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => codePointToChar(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec: string) => codePointToChar(Number.parseInt(dec, 10)));
}

const URI_ATTRIBUTE_NAMES = new Set(['href', 'src', 'action', 'formaction']);

function isBlockedUriValue(rawValue: string): boolean {
  const unquoted =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
  const decoded = Array.from(decodeHtmlEntitiesForUriCheck(unquoted))
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join('');
  return /^(?:javascript|vbscript):/i.test(decoded) || /^data:text\/html/i.test(decoded);
}

function sanitizeTagAttributes(rawAttrs: string): string {
  const attrTokenRegex = /([\s/"']*)([^\s="'<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let result = '';
  let lastIndex = 0;

  for (const match of rawAttrs.matchAll(attrTokenRegex)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      result += rawAttrs.slice(lastIndex, matchIndex);
    }
    lastIndex = matchIndex + match[0].length;

    const sep = match[1];
    const attrName = match[2];
    const attrValue = match[3];
    const normalizedName = attrName.toLowerCase();

    if (/^on[a-z]+$/.test(normalizedName) || normalizedName === 'style') {
      if (/["']/.test(sep)) {
        result += `${sep} `;
      } else if (sep.length > 0) {
        result += sep;
      } else {
        result += ' ';
      }
      continue;
    }

    if (
      attrValue !== undefined &&
      URI_ATTRIBUTE_NAMES.has(normalizedName) &&
      isBlockedUriValue(attrValue)
    ) {
      const quote = attrValue.startsWith("'") ? "'" : '"';
      result += `${sep}${attrName}=${quote}blocked:${quote}`;
      continue;
    }

    result += match[0];
  }

  if (lastIndex < rawAttrs.length) {
    result += rawAttrs.slice(lastIndex);
  }
  return result;
}

/**
 * Strips dangerous tags, inline event handlers, and executable URIs from HTML fragments.
 */
export function stripUnsafeHtml(html: string): string {
  if (!html) {
    return '';
  }
  const withoutDangerousTags = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|iframe|object|embed|svg|math|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|svg|math|meta|base)\b[^>]*\/?>/gi, '');

  return withoutDangerousTags
    .replace(
      /<([a-z][a-z0-9:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi,
      (_tag, name: string, attrs: string) => {
        const sanitizedAttrs = sanitizeTagAttributes(attrs).replace(/\s+$/g, '');
        return `<${name}${sanitizedAttrs}>`;
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
