import { describe, expect, it } from 'vitest';
import {
  isEmpty,
  isFilled,
  isNotEmpty,
  isObject,
  isPlainObject,
  omit,
  pick
} from '../../src/object.utils.js';

describe('object.utils', () => {
  describe('isEmpty', () => {
    it('should identify null and undefined as empty', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
    });

    it('should identify empty and whitespace-only strings as empty', () => {
      expect(isEmpty('')).toBe(true);
      expect(isEmpty('   ')).toBe(true);
      expect(isEmpty('\t\n')).toBe(true);
    });

    it('should identify non-empty strings as not empty', () => {
      expect(isEmpty('hello')).toBe(false);
      expect(isEmpty('  x  ')).toBe(false);
      expect(isEmpty('0')).toBe(false);
    });

    it('should treat numbers (including 0 and negative) as not empty', () => {
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(-0)).toBe(false);
      expect(isEmpty(42)).toBe(false);
      expect(isEmpty(-1)).toBe(false);
    });

    it('should treat booleans (including false) as not empty', () => {
      expect(isEmpty(false)).toBe(false);
      expect(isEmpty(true)).toBe(false);
    });

    it('should identify empty and non-empty arrays correctly', () => {
      expect(isEmpty([])).toBe(true);
      expect(isEmpty([1])).toBe(false);
      expect(isEmpty([null])).toBe(false);
      expect(isEmpty([undefined])).toBe(false);
    });

    it('should identify empty and non-empty Maps and Sets', () => {
      expect(isEmpty(new Map())).toBe(true);
      expect(isEmpty(new Set())).toBe(true);

      const map = new Map();
      map.set('a', 1);
      expect(isEmpty(map)).toBe(false);

      const set = new Set();
      set.add(1);
      expect(isEmpty(set)).toBe(false);
    });

    it('should identify empty and non-empty plain objects', () => {
      expect(isEmpty({})).toBe(true);
      expect(isEmpty(Object.create(null))).toBe(true);
      expect(isEmpty({ a: 1 })).toBe(false);
      expect(isEmpty({ a: undefined })).toBe(false);
    });

    it('should not consider Date, RegExp, or Error objects as empty', () => {
      expect(isEmpty(new Date())).toBe(false);
      expect(isEmpty(/test/)).toBe(false);
      expect(isEmpty(new Error('failure'))).toBe(false);
    });

    it('should not consider class instances or non-plain objects as empty', () => {
      expect(isEmpty(new URL('https://example.com'))).toBe(false);
      expect(isEmpty(new WeakMap())).toBe(false);
      expect(isEmpty(Promise.resolve())).toBe(false);

      class ServiceInstance {
        private value = 42;
        getValue() {
          return this.value;
        }
      }
      expect(isEmpty(new ServiceInstance())).toBe(false);
    });
  });

  describe('isFilled & isNotEmpty', () => {
    it('should invert isEmpty logic and act as type guard', () => {
      const val: string | null = 'test';
      if (isFilled(val)) {
        expect(val.toUpperCase()).toBe('TEST');
      }

      expect(isFilled(null)).toBe(false);
      expect(isFilled('   ')).toBe(false);
      expect(isFilled('active')).toBe(true);
      expect(isFilled(0)).toBe(true);
      expect(isFilled(false)).toBe(true);

      expect(isNotEmpty(null)).toBe(false);
      expect(isNotEmpty('active')).toBe(true);
    });
  });

  describe('isObject & isPlainObject', () => {
    it('should identify objects correctly', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
      expect(isObject(new Date())).toBe(true);
      expect(isObject([])).toBe(false);
      expect(isObject(null)).toBe(false);
      expect(isObject(undefined)).toBe(false);
      expect(isObject('string')).toBe(false);
      expect(isObject(123)).toBe(false);
    });

    it('should identify plain objects correctly', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
      expect(isPlainObject(Object.create(null))).toBe(true);
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject(new Map())).toBe(false);
      expect(isPlainObject([])).toBe(false);
    });
  });

  describe('pick and omit', () => {
    const data = { a: 1, b: 'two', c: true, d: null };

    it('should pick specified keys', () => {
      expect(pick(data, ['a', 'b'])).toEqual({ a: 1, b: 'two' });
    });

    it('should omit specified keys', () => {
      expect(omit(data, ['c', 'd'])).toEqual({ a: 1, b: 'two' });
    });

    it('should copy only own properties and ignore prototype properties or __proto__ in pick', () => {
      const proto = { inherited: 'yes' };
      const obj = Object.create(proto) as Record<string, unknown>;
      obj.own = 'hello';

      expect(pick(obj, ['own', 'inherited'])).toEqual({ own: 'hello' });
      expect(pick(obj, ['__proto__'])).toEqual({});
    });

    it('should safely handle __proto__ key in omit', () => {
      const obj = { a: 1, b: 2 };
      expect(omit(obj as Record<string, unknown>, ['__proto__'])).toEqual({ a: 1, b: 2 });
    });
  });
});
