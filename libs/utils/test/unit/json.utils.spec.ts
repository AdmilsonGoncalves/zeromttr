import { describe, expect, it } from 'vitest';
import { safeJsonParse } from '../../src/json.utils.js';

describe('json.utils', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON text successfully', () => {
      expect(safeJsonParse('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
      expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
      expect(safeJsonParse('"hello"')).toBe('hello');
      expect(safeJsonParse('123')).toBe(123);
      expect(safeJsonParse('true')).toBe(true);
    });

    it('should return fallback on invalid JSON text', () => {
      expect(safeJsonParse('invalid-json')).toBeNull();
      expect(safeJsonParse('{unclosed', { default: true })).toEqual({ default: true });
      expect(safeJsonParse('', 'fallback')).toBe('fallback');
    });

    it('should handle nullish or non-string input gracefully', () => {
      expect(safeJsonParse(null as any)).toBeNull();
      expect(safeJsonParse(undefined as any, 'default')).toBe('default');
    });
  });
});
