const ISO_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}(?::?\d{2})?))?)?$/;

/**
 * Checks if a value is a valid Date instance (not NaN).
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Safely parses an ISO date string or Date into a valid Date object, returning null on failure.
 * Strict ISO-8601 validation: rejects non-ISO formats, out-of-range calendar dates, and impossible leap days.
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
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = ISO_DATE_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDays) {
    return null;
  }

  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    if (hour > 23 || minute > 59 || second > 59) {
      return null;
    }
  }

  if (match[8] !== undefined) {
    const tzMatch = /^([+-])(\d{2}):?(\d{2})?$/.exec(match[8]);
    if (tzMatch) {
      const tzHours = Number(tzMatch[2]);
      const tzMinutes = Number(tzMatch[3] ?? '0');
      if (tzHours > 23 || tzMinutes > 59) {
        return null;
      }
    }
  }

  const d = new Date(trimmed);
  if (isValidDate(d)) {
    return d;
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
 * Truncates signed day difference toward zero so partial days are excluded.
 */
export function diffInDays(start: Date | string | number, end: Date | string | number): number {
  return Math.trunc(diffInHours(start, end) / 24) || 0;
}
