import { isNonEmptyString } from './string.utils.js';

/**
 * Normalizes IPv4-mapped IPv6 addresses (e.g. `::ffff:127.0.0.1` -> `127.0.0.1`).
 */
export function normalizeIp(rawIp: string): string {
  const trimmed = rawIp.trim();
  if (trimmed.toLowerCase().startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Extracts and normalizes the first client IP from a proxy header (`string` or `string[]`).
 */
export function parseForwardedIp(headerValue: string | string[] | undefined): string | null {
  if (isNonEmptyString(headerValue)) {
    const first = headerValue.split(',')[0]?.trim();
    return isNonEmptyString(first) ? normalizeIp(first) : null;
  }

  if (Array.isArray(headerValue) && isNonEmptyString(headerValue[0])) {
    const first = headerValue[0].split(',')[0]?.trim();
    return isNonEmptyString(first) ? normalizeIp(first) : null;
  }

  return null;
}
