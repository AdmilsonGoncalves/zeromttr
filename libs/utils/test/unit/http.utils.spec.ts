import { describe, expect, it } from 'vitest';
import {
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
});
