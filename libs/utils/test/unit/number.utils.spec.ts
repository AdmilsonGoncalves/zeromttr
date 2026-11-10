import { describe, expect, it } from 'vitest';
import {
  clamp,
  inRange,
  isNumber,
  parseNumber,
  percentage,
  round
} from '../../src/number.utils.js';

describe('number.utils', () => {
  describe('isNumber', () => {
    it('should return true for valid finite numbers', () => {
      expect(isNumber(0)).toBe(true);
      expect(isNumber(42)).toBe(true);
      expect(isNumber(-10.5)).toBe(true);
    });

    it('should return false for NaN and Infinity', () => {
      expect(isNumber(NaN)).toBe(false);
      expect(isNumber(Infinity)).toBe(false);
      expect(isNumber(-Infinity)).toBe(false);
    });

    it('should return false for non-numbers', () => {
      expect(isNumber('123')).toBe(false);
      expect(isNumber(null)).toBe(false);
      expect(isNumber(undefined)).toBe(false);
      expect(isNumber({})).toBe(false);
    });
  });

  describe('clamp', () => {
    it('should clamp numbers to min and max boundaries', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(4600, 0, 60000)).toBe(4600);
      expect(clamp(99999, 0, 60000)).toBe(60000);
    });

    it('should handle inverted min and max boundaries gracefully', () => {
      expect(clamp(50, 100, 0)).toBe(50);
      expect(clamp(-10, 100, 0)).toBe(0);
      expect(clamp(150, 100, 0)).toBe(100);
    });
  });

  describe('inRange', () => {
    it('should check if number falls within range [min, max]', () => {
      expect(inRange(5, 0, 10)).toBe(true);
      expect(inRange(0, 0, 10)).toBe(true);
      expect(inRange(10, 0, 10)).toBe(true);
      expect(inRange(-1, 0, 10)).toBe(false);
      expect(inRange(11, 0, 10)).toBe(false);
    });
  });

  describe('round', () => {
    it('should round numbers to given decimal places', () => {
      expect(round(3.14159, 2)).toBe(3.14);
      expect(round(3.145, 2)).toBe(3.15);
      expect(round(42.5)).toBe(43);
      expect(round(42.4)).toBe(42);
    });
  });

  describe('percentage', () => {
    it('should compute percentage with decimal places', () => {
      expect(percentage(25, 100)).toBe(25);
      expect(percentage(1, 3, 2)).toBe(33.33);
      expect(percentage(1, 3, 4)).toBe(33.3333);
    });

    it('should handle zero or negative total gracefully', () => {
      expect(percentage(10, 0)).toBe(0);
      expect(percentage(10, -5)).toBe(0);
    });
  });

  describe('parseNumber', () => {
    it('should parse numbers and numeric strings', () => {
      expect(parseNumber(42)).toBe(42);
      expect(parseNumber('42')).toBe(42);
      expect(parseNumber('  12.5  ')).toBe(12.5);
      expect(parseNumber('0')).toBe(0);
    });

    it('should return fallback for invalid inputs', () => {
      expect(parseNumber('abc')).toBe(0);
      expect(parseNumber('abc', 10)).toBe(10);
      expect(parseNumber(null, 5)).toBe(5);
      expect(parseNumber(undefined, -1)).toBe(-1);
      expect(parseNumber(NaN, 100)).toBe(100);
    });
  });
});
