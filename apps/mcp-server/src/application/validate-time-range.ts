export function validateTimeRange(
  startStr: string,
  endStr: string
): { start: Date; end: Date; startIso: string; endIso: string } {
  const start = new Date(startStr);
  const end = new Date(endStr);

  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid start timestamp: '${startStr}'. Must be valid ISO8601.`);
  }
  if (Number.isNaN(end.getTime())) {
    throw new Error(`Invalid end timestamp: '${endStr}'. Must be valid ISO8601.`);
  }
  if (start.getTime() >= end.getTime()) {
    throw new Error(`Invalid time window: start (${startStr}) must be before end (${endStr}).`);
  }

  const diffMs = end.getTime() - start.getTime();
  const maxWindowMs = 24 * 60 * 60 * 1000;
  if (diffMs > maxWindowMs) {
    throw new Error(
      `Time window exceeds maximum allowed window of 24h (${Math.round(diffMs / (60 * 60 * 1000))}h requested).`
    );
  }

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}
