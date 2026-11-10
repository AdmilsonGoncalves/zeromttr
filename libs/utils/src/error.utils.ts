import { isNonEmptyString } from './string.utils.js';

/**
 * Extracts a descriptive error message from any caught error.
 */
export function toErrorMessage(error: unknown, fallback = 'Internal error'): string {
  if (error instanceof Error && isNonEmptyString(error.message)) {
    return error.message;
  }
  if (isNonEmptyString(error)) {
    return error;
  }
  return fallback;
}
