import { describe, expect, it } from 'vitest';
import { normalizeIp, parseForwardedIp } from '../../src/ip.utils.js';

describe('ip.utils', () => {
  describe('normalizeIp', () => {
    it('should trim whitespace and strip ::ffff: IPv4-mapped IPv6 prefix', () => {
      expect(normalizeIp(' 127.0.0.1 ')).toBe('127.0.0.1');
      expect(normalizeIp('::ffff:198.51.100.10')).toBe('198.51.100.10');
      expect(normalizeIp('::FFFF:203.0.113.5')).toBe('203.0.113.5');
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
      expect(normalizeIp('')).toBe('');
    });
  });

  describe('parseForwardedIp', () => {
    it('should extract and normalize the first client IP from string or string[] headers', () => {
      expect(parseForwardedIp('203.0.113.77, 10.0.0.1')).toBe('203.0.113.77');
      expect(parseForwardedIp('::ffff:198.51.100.10, 10.0.0.2')).toBe('198.51.100.10');
      expect(parseForwardedIp(['2001:db8::2, 10.0.0.1', '10.0.0.2'])).toBe('2001:db8::2');
    });

    it('should return null when header is missing, empty, or blank', () => {
      expect(parseForwardedIp(undefined)).toBeNull();
      expect(parseForwardedIp('')).toBeNull();
      expect(parseForwardedIp('   ')).toBeNull();
      expect(parseForwardedIp([])).toBeNull();
      expect(parseForwardedIp(['   '])).toBeNull();
    });
  });
});
