import { describe, expect, it } from 'vitest';
import {
  CONTENT_TYPE,
  HTTP_HEADERS,
  HTTP_STATUS,
  buildQueryParams,
  buildUrl,
  isHttpSuccess,
  safeHttpUrl,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '../../src/http.utils.js';

describe('http.utils', () => {
  describe('buildQueryParams', () => {
    it('should build URL query string from object', () => {
      const params = { foo: 'bar', page: 1, active: true };
      expect(buildQueryParams(params)).toBe('foo=bar&page=1&active=true');
    });

    it('should ignore null and undefined values', () => {
      const params = { foo: 'bar', empty: null, missing: undefined, count: 0 };
      expect(buildQueryParams(params)).toBe('foo=bar&count=0');
    });

    it('should return empty string for empty object or all nullish params', () => {
      expect(buildQueryParams({})).toBe('');
      expect(buildQueryParams({ a: null, b: undefined })).toBe('');
    });

    it('should encode URI components properly', () => {
      const params = { query: 'test & demo = 100%' };
      expect(buildQueryParams(params)).toBe('query=test+%26+demo+%3D+100%25');
    });
  });

  describe('sanitizeHeaderValue', () => {
    it('should strip CRLF characters to prevent HTTP response splitting', () => {
      const malicious = 'application/json\r\nX-Injected-Header: injected';
      expect(sanitizeHeaderValue(malicious)).toBe('application/jsonX-Injected-Header: injected');
    });

    it('should return safe header as is trimmed', () => {
      expect(sanitizeHeaderValue('  application/json  ')).toBe('application/json');
    });
  });

  describe('isHttpSuccess', () => {
    it('should return true for 2xx status codes', () => {
      expect(isHttpSuccess(200)).toBe(true);
      expect(isHttpSuccess(201)).toBe(true);
      expect(isHttpSuccess(204)).toBe(true);
      expect(isHttpSuccess(299)).toBe(true);
    });

    it('should return false for non-2xx status codes', () => {
      expect(isHttpSuccess(199)).toBe(false);
      expect(isHttpSuccess(301)).toBe(false);
      expect(isHttpSuccess(400)).toBe(false);
      expect(isHttpSuccess(404)).toBe(false);
      expect(isHttpSuccess(500)).toBe(false);
    });
  });

  describe('trimTrailingSlash', () => {
    it('should strip trailing slashes from URLs or paths', () => {
      expect(trimTrailingSlash('http://localhost:9090/')).toBe('http://localhost:9090');
      expect(trimTrailingSlash('http://localhost:9090///')).toBe('http://localhost:9090');
      expect(trimTrailingSlash('http://localhost:9090')).toBe('http://localhost:9090');
      expect(trimTrailingSlash('')).toBe('');
    });
  });

  describe('buildUrl', () => {
    it('should assemble baseUrl, path and query parameters', () => {
      const url = buildUrl('http://localhost:9090/', '/api/v1/query', {
        query: 'up',
        limit: 10
      });
      expect(url).toBe('http://localhost:9090/api/v1/query?query=up&limit=10');
    });

    it('should handle missing path or missing params', () => {
      expect(buildUrl('http://localhost:9090/')).toBe('http://localhost:9090');
      expect(buildUrl('http://localhost:9090', 'health')).toBe('http://localhost:9090/health');
      expect(buildUrl('http://localhost:9090', '/health', {})).toBe('http://localhost:9090/health');
    });

    it('should preserve and merge query parameters when baseUrl already contains queries and hash', () => {
      const url = buildUrl('https://example.com/api?token=abc#section', '/users', {
        page: 2,
        filter: 'active'
      });
      expect(url).toBe('https://example.com/api/users?token=abc&page=2&filter=active#section');
    });

    it('should merge path query parameters and argument params into base URL query', () => {
      const url = buildUrl('https://example.com/api?base=1', '/items?sub=2', { extra: 3 });
      expect(url).toBe('https://example.com/api/items?base=1&sub=2&extra=3');
    });

    it('should handle relative base URLs and preserve existing query parameters', () => {
      const url = buildUrl('/api?env=prod', 'status', { details: true });
      expect(url).toBe('/api/status?env=prod&details=true');
    });
  });

  describe('safeHttpUrl', () => {
    it('should validate and return http/https URLs', () => {
      expect(safeHttpUrl('https://github.com/AdmilsonGoncalves/zeromttr')).toBe(
        'https://github.com/AdmilsonGoncalves/zeromttr'
      );
      expect(safeHttpUrl('http://localhost:8080/decision#hash')).toBe(
        'http://localhost:8080/decision#hash'
      );
    });

    it('should reject non-http schemes like javascript: or file:', () => {
      expect(safeHttpUrl('javascript:alert(1)')).toBe('#');
      expect(safeHttpUrl('file:///etc/passwd')).toBe('#');
      expect(safeHttpUrl('invalid-url')).toBe('#');
      expect(safeHttpUrl('')).toBe('#');
    });
  });

  describe('HTTP_STATUS', () => {
    it('should expose standard HTTP status constants', () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.CREATED).toBe(201);
      expect(HTTP_STATUS.ACCEPTED).toBe(202);
      expect(HTTP_STATUS.NO_CONTENT).toBe(204);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.FORBIDDEN).toBe(403);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.CONFLICT).toBe(409);
      expect(HTTP_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
      expect(HTTP_STATUS.UNPROCESSABLE_ENTITY).toBe(422);
      expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429);
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
    });
  });

  describe('HTTP_HEADERS and CONTENT_TYPE', () => {
    it('should expose standard HTTP header and MIME constants', () => {
      expect(HTTP_HEADERS.ACCEPT).toBe('Accept');
      expect(HTTP_HEADERS.AUTHORIZATION).toBe('Authorization');
      expect(HTTP_HEADERS.AUTHORIZATION_LOWER).toBe('authorization');
      expect(HTTP_HEADERS.CACHE_CONTROL).toBe('Cache-Control');
      expect(HTTP_HEADERS.CONNECTION).toBe('Connection');
      expect(HTTP_HEADERS.CONTENT_TYPE).toBe('Content-Type');
      expect(HTTP_HEADERS.LIVE_DEMO_KEY).toBe('X-Live-Demo-Key');
      expect(HTTP_HEADERS.LIVE_DEMO_KEY_LOWER).toBe('x-live-demo-key');
      expect(HTTP_HEADERS.SETTINGS_ADMIN_TOKEN).toBe('X-Settings-Admin-Token');
      expect(HTTP_HEADERS.SETTINGS_ADMIN_TOKEN_LOWER).toBe('x-settings-admin-token');
      expect(HTTP_HEADERS.TURNSTILE_TOKEN).toBe('X-Turnstile-Token');
      expect(HTTP_HEADERS.TURNSTILE_TOKEN_LOWER).toBe('x-turnstile-token');
      expect(HTTP_HEADERS.CF_TURNSTILE_RESPONSE).toBe('CF-Turnstile-Response');
      expect(HTTP_HEADERS.CF_TURNSTILE_RESPONSE_LOWER).toBe('cf-turnstile-response');
      expect(HTTP_HEADERS.CF_CONNECTING_IP_LOWER).toBe('cf-connecting-ip');
      expect(HTTP_HEADERS.X_ACCEL_BUFFERING).toBe('X-Accel-Buffering');
      expect(HTTP_HEADERS.X_FORWARDED_FOR_LOWER).toBe('x-forwarded-for');
      expect(HTTP_HEADERS.X_REAL_IP_LOWER).toBe('x-real-ip');
      expect(CONTENT_TYPE.JSON).toBe('application/json');
      expect(CONTENT_TYPE.TEXT_PLAIN).toBe('text/plain');
      expect(CONTENT_TYPE.EVENT_STREAM).toBe('text/event-stream');
      expect(CONTENT_TYPE.FORM_URLENCODED).toBe('application/x-www-form-urlencoded');
    });
  });
});
