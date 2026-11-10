import { isNonEmptyString } from './string.utils.js';

/**
 * Checks if a value is a valid finite number (excluding NaN, Infinity, -Infinity).
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Clamps a number within the inclusive lower and upper bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  const [lower, upper] = min <= max ? [min, max] : [max, min];
  if (value < lower) {
    return lower;
  }
  if (value > upper) {
    return upper;
  }
  return value;
}

/**
 * Checks if a number falls within the specified [min, max] range (inclusive).
 */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Rounds a number to a specified number of decimal digits with standard rounding.
 */
export function round(value: number, decimals = 0): number {
  if (!isNumber(value)) {
    return value;
  }
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Calculates percentage of part relative to total, with specified decimal precision.
 * Returns 0 if total is non-positive.
 */
export function percentage(part: number, total: number, decimals = 2): number {
  if (total <= 0 || !isNumber(total) || !isNumber(part)) {
    return 0;
  }
  return round((part / total) * 100, decimals);
}

/**
 * Parses unknown value into a finite number, returning a fallback on failure.
 */
export function parseNumber(value: unknown, fallback = 0): number {
  if (isNumber(value)) {
    return value;
  }
  if (isNonEmptyString(value)) {
    const num = Number(value);
    return isNumber(num) ? num : fallback;
  }
  return fallback;
}
