/**
 * Checks if a value is an Array.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Checks if a value is an Array with at least one element.
 */
export function isNonEmptyArray<T>(value: unknown): value is [T, ...T[]] {
  return isArray(value) && value.length > 0;
}

/**
 * Removes null and undefined elements from an array, preserving other values (such as 0, false, '').
 */
export function compact<T>(array: (T | null | undefined)[]): T[] {
  const result: T[] = [];
  for (const item of array) {
    if (item !== null && item !== undefined) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Splits an array into chunks of the given size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0 || !isArray(array)) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deduplicates elements in an array. Supports an optional key selector function.
 */
export function unique<T, K = T>(array: T[], keySelector?: (item: T) => K): T[] {
  if (!keySelector) {
    return Array.from(new Set(array));
  }

  const seen = new Set<K>();
  const result: T[] = [];

  for (const item of array) {
    const key = keySelector(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}
