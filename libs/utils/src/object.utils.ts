import { isArray } from './array.utils.js';
import { isString } from './string.utils.js';

/**
 * Checks if a value is empty.
 * Returns true for:
 * - null, undefined
 * - strings that are empty or contain only whitespace
 * - empty arrays
 * - empty Maps, Sets
 * - empty plain objects
 *
 * Returns false for:
 * - numbers (including 0, -0, NaN)
 * - booleans (including false)
 * - Date, RegExp, Error
 * - class instances and non-plain objects (URL, Promise, etc.)
 * - non-empty collections/strings
 */
export function isEmpty(
  value: unknown
): value is null | undefined | '' | Record<string, never> | [] {
  if (value === null || value === undefined) {
    return true;
  }

  if (isString(value)) {
    return value.trim().length === 0;
  }

  if (isArray(value)) {
    return value.length === 0;
  }

  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }

  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {
    return false;
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length === 0;
  }

  return false;
}

/**
 * Type guard checking that a value is not empty.
 * Inverts `isEmpty` and narrows the type to non-null/non-undefined.
 */
export function isFilled<T>(value: T | null | undefined): value is NonNullable<T> {
  return !isEmpty(value);
}

/**
 * Alias for `isFilled`.
 */
export function isNotEmpty<T>(value: T | null | undefined): value is NonNullable<T> {
  return isFilled(value);
}

/**
 * Checks if a value is a non-null, non-array object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if a value is a plain JavaScript object literal or created with Object.create(null).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Creates a shallow copy of an object picking only specified keys.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Creates a shallow copy of an object omitting specified keys.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}
