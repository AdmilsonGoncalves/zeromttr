import { isEmpty } from './object.utils.js';

interface UrlParts {
  pathname: string;
  query: string;
  hash: string;
}

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
 * Preserves pre-existing query parameters and fragments from baseUrl and path,
 * correctly inserting the path into the pathname before query string or fragment.
 */
export function buildUrl(baseUrl: string, path = '', params?: Record<string, unknown>): string {
  if (!baseUrl) {
    return '';
  }

  const baseParts = parseUrlParts(baseUrl);
  const pathParts = parseUrlParts(path);

  const cleanBase = trimTrailingSlash(baseParts.pathname);
  let cleanPath = pathParts.pathname;
  if (cleanPath && !cleanPath.startsWith('/')) {
    cleanPath = `/${cleanPath}`;
  }

  const fullPath = cleanPath ? `${cleanBase}${cleanPath}` : cleanBase;

  const searchParams = new URLSearchParams();
  if (baseParts.query) {
    const baseSearchParams = new URLSearchParams(baseParts.query);
    for (const [key, value] of baseSearchParams.entries()) {
      searchParams.append(key, value);
    }
  }

  if (pathParts.query) {
    const pathSearchParams = new URLSearchParams(pathParts.query);
    for (const [key, value] of pathSearchParams.entries()) {
      searchParams.append(key, value);
    }
  }

  if (params && !isEmpty(params)) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
  }

  const queryString = searchParams.toString();
  const fragment = pathParts.hash || baseParts.hash;

  return `${fullPath}${queryString ? `?${queryString}` : ''}${fragment}`;
}

function parseUrlParts(url: string): UrlParts {
  let main = url;
  let hash = '';
  let query = '';

  const hashIndex = main.indexOf('#');
  if (hashIndex !== -1) {
    hash = main.slice(hashIndex);
    main = main.slice(0, hashIndex);
  }

  const queryIndex = main.indexOf('?');
  if (queryIndex !== -1) {
    query = main.slice(queryIndex + 1);
    main = main.slice(0, queryIndex);
  }

  return { pathname: main, query, hash };
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
 * Standard HTTP header names used across adapters and HTTP transport boundaries.
 */
export const HTTP_HEADERS = {
  ACCEPT: 'Accept',
  AUTHORIZATION: 'Authorization',
  AUTHORIZATION_LOWER: 'authorization',
  CACHE_CONTROL: 'Cache-Control',
  CONNECTION: 'Connection',
  CONTENT_TYPE: 'Content-Type',
  LIVE_DEMO_KEY: 'X-Live-Demo-Key',
  LIVE_DEMO_KEY_LOWER: 'x-live-demo-key',
  TURNSTILE_TOKEN: 'X-Turnstile-Token',
  TURNSTILE_TOKEN_LOWER: 'x-turnstile-token',
  CF_TURNSTILE_RESPONSE: 'CF-Turnstile-Response',
  CF_TURNSTILE_RESPONSE_LOWER: 'cf-turnstile-response',
  CF_CONNECTING_IP_LOWER: 'cf-connecting-ip',
  X_ACCEL_BUFFERING: 'X-Accel-Buffering',
  X_FORWARDED_FOR_LOWER: 'x-forwarded-for',
  X_REAL_IP_LOWER: 'x-real-ip'
} as const;

export type HttpHeaderName = (typeof HTTP_HEADERS)[keyof typeof HTTP_HEADERS];

/**
 * Standard MIME media types used in HTTP `Content-Type` and `Accept` headers.
 */
export const CONTENT_TYPE = {
  JSON: 'application/json',
  TEXT_PLAIN: 'text/plain',
  EVENT_STREAM: 'text/event-stream',
  FORM_URLENCODED: 'application/x-www-form-urlencoded'
} as const;

export type ContentTypeValue = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE];

/**
 * Standard HTTP status codes used across adapters and HTTP transport boundaries.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/**
 * Returns true if an HTTP status code represents a 2xx success.
 */
export function isHttpSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}
