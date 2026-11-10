import { isEmpty } from './object.utils.js';

/**
 * Builds a URL encoded query string from an object, skipping null and undefined values.
 */
export function buildQueryParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      searchParams.append(key, String(value));
    }
  }

  return searchParams.toString();
}

/**
 * Removes any trailing slashes from a URL or path.
 */
export function trimTrailingSlash(url: string): string {
  if (!url) {
    return '';
  }
  return url.replace(/\/+$/, '');
}

/**
 * Composes a full URL from a base URL, path, and optional query parameters.
 */
export function buildUrl(baseUrl: string, path = '', params?: Record<string, unknown>): string {
  const cleanBase = trimTrailingSlash(baseUrl);
  let fullPath = cleanBase;

  if (path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    fullPath = `${cleanBase}${cleanPath}`;
  }

  if (!params || isEmpty(params)) {
    return fullPath;
  }

  const query = buildQueryParams(params);
  if (!query) {
    return fullPath;
  }

  return `${fullPath}?${query}`;
}

/**
 * Validates and normalizes an HTTP/HTTPS URL, returning a fallback '#' on invalid or non-HTTP protocols.
 */
export function safeHttpUrl(raw: string, fallback = '#'): string {
  if (!raw) {
    return fallback;
  }
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return u.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sanitizes HTTP header values by stripping CRLF (\r, \n) to prevent HTTP response splitting.
 */
export function sanitizeHeaderValue(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/[\r\n]/g, '').trim();
}

/**
 * Returns true if an HTTP status code represents a 2xx success.
 */
export function isHttpSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}
