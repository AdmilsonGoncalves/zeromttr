import { describe, expect, it } from 'vitest';
import { chunk, compact, isArray, isNonEmptyArray, unique } from '../../src/array.utils.js';

describe('array.utils', () => {
  describe('isArray', () => {
    it('should correctly identify arrays', () => {
      expect(isArray([])).toBe(true);
      expect(isArray([1, 2, 3])).toBe(true);
      expect(isArray('string')).toBe(false);
      expect(isArray(null)).toBe(false);
      expect(isArray({})).toBe(false);
    });
  });

  describe('isNonEmptyArray', () => {
    it('should identify arrays with at least one element', () => {
      expect(isNonEmptyArray([1])).toBe(true);
      expect(isNonEmptyArray([null])).toBe(true);
      expect(isNonEmptyArray([])).toBe(false);
      expect(isNonEmptyArray(null)).toBe(false);
      expect(isNonEmptyArray('abc')).toBe(false);
    });
  });

  describe('compact', () => {
    it('should remove null and undefined values while preserving falsy values like 0 and false', () => {
      const input = [1, null, 'hello', undefined, 0, false, '', 'valid'];
      expect(compact(input)).toEqual([1, 'hello', 0, false, '', 'valid']);
    });

    it('should return empty array when input contains only null/undefined', () => {
      expect(compact([null, undefined])).toEqual([]);
    });
  });

  describe('chunk', () => {
    it('should partition array into chunks of specified size', () => {
      const input = [1, 2, 3, 4, 5];
      expect(chunk(input, 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should handle chunk size larger than array length', () => {
      expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    });

    it('should return empty array for empty input or invalid size', () => {
      expect(chunk([], 2)).toEqual([]);
      expect(chunk([1, 2], 0)).toEqual([]);
      expect(chunk([1, 2], -1)).toEqual([]);
    });
  });

  describe('unique', () => {
    it('should deduplicate primitive items preserving order', () => {
      expect(unique([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
      expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('should support custom keySelector function', () => {
      const items = [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
        { id: 1, name: 'duplicate' }
      ];
      expect(unique(items, (item) => item.id)).toEqual([
        { id: 1, name: 'first' },
        { id: 2, name: 'second' }
      ]);
    });
  });
});
