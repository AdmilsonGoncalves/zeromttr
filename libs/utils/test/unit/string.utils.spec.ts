import { describe, expect, it } from 'vitest';
import {
  capitalize,
  escapeHtml,
  isNonEmptyString,
  isSafeRelativePath,
  isString,
  sanitizeWhitespace,
  truncate
} from '../../src/string.utils.js';

describe('string.utils', () => {
  describe('isString', () => {
    it('should correctly identify strings', () => {
      expect(isString('')).toBe(true);
      expect(isString('hello')).toBe(true);
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString({})).toBe(false);
      expect(isString([])).toBe(false);
    });
  });

  describe('isNonEmptyString', () => {
    it('should identify strings with non-whitespace characters', () => {
      expect(isNonEmptyString('a')).toBe(true);
      expect(isNonEmptyString('  test  ')).toBe(true);
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString('   ')).toBe(false);
      expect(isNonEmptyString('\n\t')).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
    });

    it('should narrow type to string in conditionals', () => {
      const candidate: unknown = '  hello  ';
      if (isNonEmptyString(candidate)) {
        expect(candidate.trim()).toBe('hello');
      }
    });
  });

  describe('truncate', () => {
    it('should truncate strings exceeding maxLength and append suffix', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
      expect(truncate('hello world', 5, ' [MORE]')).toBe('hello [MORE]');
    });

    it('should return original string if within maxLength', () => {
      expect(truncate('hello', 10)).toBe('hello');
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('should handle empty or whitespace strings', () => {
      expect(truncate('', 5)).toBe('');
    });
  });

  describe('capitalize', () => {
    it('should capitalize first character of a string', () => {
      expect(capitalize('hello')).toBe('Hello');
      expect(capitalize('WORLD')).toBe('World');
      expect(capitalize('')).toBe('');
      expect(capitalize('a')).toBe('A');
    });
  });

  describe('sanitizeWhitespace', () => {
    it('should normalize consecutive spaces, newlines, and tabs', () => {
      expect(sanitizeWhitespace('  hello   world  \n\t foo ')).toBe('hello world foo');
      expect(sanitizeWhitespace('')).toBe('');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML sensitive characters', () => {
      const malicious = '<script>alert("XSS" & \'test\')</script>';
      expect(escapeHtml(malicious)).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot; &amp; &#039;test&#039;)&lt;/script&gt;'
      );
    });

    it('should return empty string for falsy/empty values', () => {
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(null as any)).toBe('');
    });
  });

  describe('isSafeRelativePath', () => {
    it('should allow valid relative paths without dot segments', () => {
      expect(isSafeRelativePath('src/main.ts')).toBe(true);
      expect(isSafeRelativePath('apps/target-app-demo/package.json')).toBe(true);
      expect(isSafeRelativePath('README.md')).toBe(true);
    });

    it('should reject path traversal attempts and absolute paths', () => {
      expect(isSafeRelativePath('../secrets.env')).toBe(false);
      expect(isSafeRelativePath('src/../../etc/passwd')).toBe(false);
      expect(isSafeRelativePath('./relative')).toBe(false);
      expect(isSafeRelativePath('/etc/shadow')).toBe(false);
      expect(isSafeRelativePath('C:\\Windows\\system32')).toBe(false);
      expect(isSafeRelativePath('')).toBe(false);
      expect(isSafeRelativePath('   ')).toBe(false);
    });
  });
});
