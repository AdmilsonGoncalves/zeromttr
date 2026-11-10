/**
 * Checks if a value is a valid Date instance (not NaN).
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Safely parses an ISO date string or Date into a valid Date object, returning null on failure.
 */
export function parseIsoDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (isValidDate(value)) {
      return value;
    }
    return null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const d = new Date(value);
    if (isValidDate(d)) {
      return d;
    }
  }
  return null;
}

/**
 * Returns current timestamp as ISO 8601 string.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Converts a millisecond timestamp to nanoseconds string representation (for OpenTelemetry).
 */
export function millisToUnixNano(millis: number): string {
  return String(BigInt(Math.max(0, Math.floor(millis))) * 1_000_000n);
}

/**
 * Returns current wall-clock time as a nanoseconds string representation (for OpenTelemetry).
 */
export function nowUnixNano(): string {
  return millisToUnixNano(Date.now());
}

/**
 * Calculates duration in seconds with fractional precision between two millisecond timestamps.
 */
export function durationInSeconds(startTimeMs: number, endTimeMs = Date.now()): number {
  if (endTimeMs < startTimeMs) {
    return 0;
  }
  return (endTimeMs - startTimeMs) / 1000;
}

/**
 * Normalizes input date to timestamp in milliseconds.
 */
function toEpochMs(input: Date | string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  const date = parseIsoDate(input);
  return date ? date.getTime() : null;
}

/**
 * Returns difference in seconds between two dates/timestamps (end - start).
 */
export function diffInSeconds(start: Date | string | number, end: Date | string | number): number {
  const s = toEpochMs(start);
  const e = toEpochMs(end);
  if (s === null || e === null) {
    return 0;
  }
  return (e - s) / 1000;
}

/**
 * Returns difference in minutes between two dates/timestamps (end - start).
 */
export function diffInMinutes(start: Date | string | number, end: Date | string | number): number {
  return diffInSeconds(start, end) / 60;
}

/**
 * Returns difference in hours between two dates/timestamps (end - start).
 */
export function diffInHours(start: Date | string | number, end: Date | string | number): number {
  return diffInMinutes(start, end) / 60;
}

/**
 * Returns difference in full days between two dates/timestamps (end - start).
 */
export function diffInDays(start: Date | string | number, end: Date | string | number): number {
  return diffInHours(start, end) / 24;
}
