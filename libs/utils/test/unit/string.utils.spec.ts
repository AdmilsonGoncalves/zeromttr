import { describe, expect, it } from 'vitest';
import {
  capitalize,
  escapeHtml,
  isNonEmptyString,
  isSafeRelativePath,
  isString,
  sanitizeWhitespace,
  stripUnsafeHtml,
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

  describe('stripUnsafeHtml', () => {
    it('should strip script tags, inline event handlers, and javascript: URIs', () => {
      const dirty =
        '<div onclick="alert(1)"><script>alert("xss")</script><a href="javascript:void(0)">Link</a><p>Safe</p></div>';
      const cleaned = stripUnsafeHtml(dirty);
      expect(cleaned).not.toContain('<script');
      expect(cleaned).not.toContain('onclick=');
      expect(cleaned).toContain('href="blocked:"');
      expect(cleaned).toContain('<p>Safe</p>');
    });

    it('should return empty string for empty input', () => {
      expect(stripUnsafeHtml('')).toBe('');
    });

    it('should strip slash-delimited event handlers, svg/iframe tags, and encoded/data URIs', () => {
      const dirty =
        '<img/onerror=alert(1) src=x><svg onload=alert(1)></svg><iframe srcdoc="<script>1</script>"></iframe><a href="data:text/html,<script>1</script>">Bad</a><a href="&#106;avascript:alert(1)">Encoded</a><a href="https://example.com/ok">Safe</a>';
      const cleaned = stripUnsafeHtml(dirty);
      expect(cleaned).not.toMatch(/onerror/i);
      expect(cleaned).not.toMatch(/<svg/i);
      expect(cleaned).not.toMatch(/<iframe/i);
      expect(cleaned).not.toContain('data:text/html');
      expect(cleaned).not.toContain('&#106;avascript:');
      expect(cleaned).toContain('href="blocked:"');
      expect(cleaned).toContain('https://example.com/ok');
    });

    it('should handle out-of-range numeric character references safely without throwing and preserve valid hex/decimal decoding', () => {
      const input =
        '<a href="https://example.com/?q=&#x110000;&#99999999;">OutOfRange</a><a href="&#x6a;avascript:alert(1)">HexJs</a><a href="&#106;avascript:alert(2)">DecJs</a><a href="https://example.com/&#x41;&#66;">Valid</a>';
      const cleaned = stripUnsafeHtml(input);
      expect(cleaned).toContain('https://example.com/?q=&#x110000;&#99999999;');
      expect(cleaned).not.toContain('&#x6a;avascript:');
      expect(cleaned).not.toContain('&#106;avascript:');
      expect(cleaned).toContain('href="blocked:"');
      expect(cleaned).toContain('https://example.com/&#x41;&#66;');
    });

    it('should strip inline style attributes to prevent style injection and sanitizer warnings', () => {
      const input =
        '<div style="font-family: sans-serif; color: #0f172a;"><h3 style=\'color: red;\'>Alert</h3><p class="text-xs">Body</p></div>';
      const cleaned = stripUnsafeHtml(input);
      expect(cleaned).not.toMatch(/\sstyle\s*=/i);
      expect(cleaned).toContain('<h3>Alert</h3>');
      expect(cleaned).toContain('<p class="text-xs">Body</p>');
    });

    it('should preserve attribute separators when stripping style so adjacent tokens never merge into executable handlers', () => {
      const splitHandler = '<img o style="x"nerror="alert(1)" src=x>';
      const adjacentHandler = '<div class="a" style="x"onmouseover=alert(1)>hi</div>';
      const adjacentClass = '<div style="color:red"class="x">hi</div>';

      const cleanedSplit = stripUnsafeHtml(splitHandler);
      const cleanedAdjacent = stripUnsafeHtml(adjacentHandler);
      const cleanedClass = stripUnsafeHtml(adjacentClass);

      expect(cleanedSplit).not.toMatch(/\bonerror\s*=/i);
      expect(cleanedSplit).not.toMatch(/\bstyle\s*=/i);
      expect(cleanedAdjacent).not.toMatch(/\bonmouseover\s*=/i);
      expect(cleanedAdjacent).not.toMatch(/\bstyle\s*=/i);
      expect(cleanedClass).toBe('<div class="x">hi</div>');
    });

    it('should preserve text and legitimate attribute values containing style= or on*= while still blocking unquoted entity URIs', () => {
      const textAndAttr =
        '<a title="btn style=x onclick=noop" onclick="alert(1)">Use style=compact and onclick=1</a>';
      const cleanedTextAndAttr = stripUnsafeHtml(textAndAttr);
      expect(cleanedTextAndAttr).toBe(
        '<a title="btn style=x onclick=noop">Use style=compact and onclick=1</a>'
      );

      const unquotedEntityUri =
        '<a href=&#106;avascript:alert(1)>Bad</a><img src=&#x6a;avascript:alert(2)>';
      const cleanedUnquoted = stripUnsafeHtml(unquotedEntityUri);
      expect(cleanedUnquoted).not.toContain('&#106;avascript:');
      expect(cleanedUnquoted).not.toContain('&#x6a;avascript:');
      expect(cleanedUnquoted).toContain('href="blocked:"');
      expect(cleanedUnquoted).toContain('src="blocked:"');
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
