import { nowIso } from '@zeromttr/utils';

export interface Clock {
  now(): number;
  iso(): string;
}

export class SystemClock implements Clock {
  /**
   * Returns the current Unix epoch timestamp in milliseconds.
   */
  public now(): number {
    return Date.now();
  }

  /**
   * Returns the current UTC timestamp formatted as an ISO8601 string.
   */
  public iso(): string {
    return nowIso();
  }
}
