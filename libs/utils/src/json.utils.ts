/**
 * Safely parses a JSON string, returning a fallback value if parsing fails.
 */
export function safeJsonParse<T = unknown>(text: string, fallback: T | null = null): T | null {
  if (typeof text !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
