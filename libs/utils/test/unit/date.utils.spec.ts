import { describe, expect, it } from 'vitest';
import {
  diffInDays,
  diffInHours,
  diffInMinutes,
  diffInSeconds,
  durationInSeconds,
  isValidDate,
  millisToUnixNano,
  nowIso,
  nowUnixNano,
  parseIsoDate
} from '../../src/date.utils.js';

describe('date.utils', () => {
  describe('isValidDate', () => {
    it('should return true for valid Date instances', () => {
      expect(isValidDate(new Date())).toBe(true);
      expect(isValidDate(new Date('2026-11-10T12:00:00Z'))).toBe(true);
    });

    it('should return false for invalid Date instances or non-dates', () => {
      expect(isValidDate(new Date('invalid-date'))).toBe(false);
      expect(isValidDate('2026-11-10T12:00:00Z')).toBe(false);
      expect(isValidDate(null)).toBe(false);
      expect(isValidDate(undefined)).toBe(false);
      expect(isValidDate(1731240000000)).toBe(false);
    });
  });

  describe('parseIsoDate', () => {
    it('should parse valid ISO strings and Date instances into Date', () => {
      const parsed = parseIsoDate('2026-11-10T12:00:00.000Z');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe('2026-11-10T12:00:00.000Z');

      const existing = new Date('2026-11-10T12:00:00.000Z');
      expect(parseIsoDate(existing)?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    });

    it('should return null for invalid date strings or non-date values', () => {
      expect(parseIsoDate('not-a-date')).toBeNull();
      expect(parseIsoDate('')).toBeNull();
      expect(parseIsoDate(null)).toBeNull();
      expect(parseIsoDate(undefined)).toBeNull();
    });

    it('should reject non-ISO strings and impossible calendar dates', () => {
      expect(parseIsoDate('2024-02-31')).toBeNull();
      expect(parseIsoDate('2023-02-29')).toBeNull(); // 2023 is not a leap year
      expect(parseIsoDate('2024-04-31')).toBeNull(); // April has 30 days
      expect(parseIsoDate('2024-12-31T25:00:00Z')).toBeNull(); // invalid hour
      expect(parseIsoDate('2024-12-31T23:61:00Z')).toBeNull(); // invalid minute
      expect(parseIsoDate('2024/02/15')).toBeNull(); // non-ISO format
      expect(parseIsoDate('February 15, 2024')).toBeNull(); // non-ISO format
      expect(parseIsoDate('15-02-2024')).toBeNull(); // non-ISO format
    });

    it('should accept valid leap year dates and offset ISO strings', () => {
      expect(parseIsoDate('2024-02-29')).not.toBeNull();
      expect(parseIsoDate('2024-02-29T12:00:00+03:00')).not.toBeNull();
    });
  });

  describe('nowIso', () => {
    it('should return a valid ISO8601 string representation of now', () => {
      const iso = nowIso();
      expect(typeof iso).toBe('string');
      expect(isValidDate(new Date(iso))).toBe(true);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });

  describe('nowUnixNano and millisToUnixNano', () => {
    it('should convert milliseconds to nanoseconds string representation for OTel', () => {
      expect(millisToUnixNano(1000)).toBe('1000000000');
      expect(millisToUnixNano(0)).toBe('0');
    });

    it('should generate current nanoseconds string', () => {
      const nano = nowUnixNano();
      expect(typeof nano).toBe('string');
      expect(nano.length).toBeGreaterThan(15);
    });
  });

  describe('durationInSeconds', () => {
    it('should compute duration in seconds with fractional precision', () => {
      const start = 1000;
      const end = 3500;
      expect(durationInSeconds(start, end)).toBe(2.5);
    });

    it('should fallback to 0 when end is before start', () => {
      expect(durationInSeconds(5000, 2000)).toBe(0);
    });
  });

  describe('diffInSeconds, diffInMinutes, diffInHours, diffInDays', () => {
    const t0 = '2026-11-10T00:00:00.000Z';
    const t1 = '2026-11-10T01:30:00.000Z'; // 90 min = 5400 sec = 1.5 h
    const t2 = '2026-11-12T00:00:00.000Z'; // 48 h = 2 days

    it('should compute diff in seconds', () => {
      expect(diffInSeconds(t0, t1)).toBe(5400);
      expect(diffInSeconds(new Date(t0), new Date(t1))).toBe(5400);
    });

    it('should compute diff in minutes', () => {
      expect(diffInMinutes(t0, t1)).toBe(90);
    });

    it('should compute diff in hours', () => {
      expect(diffInHours(t0, t1)).toBe(1.5);
    });

    it('should compute diff in days', () => {
      expect(diffInDays(t0, t2)).toBe(2);
    });

    it('should truncate signed day difference toward zero to exclude partial days', () => {
      const start = '2026-11-10T00:00:00.000Z';
      const endPlus36h = '2026-11-11T12:00:00.000Z'; // 1.5 days -> 1
      const endMinus36h = '2026-11-08T12:00:00.000Z'; // -1.5 days -> -1
      const endPlus12h = '2026-11-10T12:00:00.000Z'; // 0.5 days -> 0
      const endMinus12h = '2026-11-09T12:00:00.000Z'; // -0.5 days -> 0

      expect(diffInDays(start, endPlus36h)).toBe(1);
      expect(diffInDays(start, endMinus36h)).toBe(-1);
      expect(diffInDays(start, endPlus12h)).toBe(0);
      expect(diffInDays(start, endMinus12h)).toBe(0);
    });

    it('should return 0 when either timestamp is invalid', () => {
      expect(diffInSeconds('invalid', t1)).toBe(0);
      expect(diffInHours(t0, 'invalid')).toBe(0);
    });
  });
});
