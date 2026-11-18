import { diffInHours, parseIsoDate, round } from '@zeromttr/utils';

export function validateTimeRange(
  startStr: string,
  endStr: string
): { start: Date; end: Date; startIso: string; endIso: string } {
  const start = parseIsoDate(startStr);
  const end = parseIsoDate(endStr);

  if (!start) {
    throw new Error(`Invalid start timestamp: '${startStr}'. Must be valid ISO8601.`);
  }
  if (!end) {
    throw new Error(`Invalid end timestamp: '${endStr}'. Must be valid ISO8601.`);
  }
  if (start.getTime() >= end.getTime()) {
    throw new Error(`Invalid time window: start (${startStr}) must be before end (${endStr}).`);
  }

  const hours = diffInHours(start, end);
  if (hours > 24) {
    throw new Error(
      `Time window exceeds maximum allowed window of 24h (${round(hours)}h requested).`
    );
  }

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}
