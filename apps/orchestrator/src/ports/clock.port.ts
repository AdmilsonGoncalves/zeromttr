import { nowIso } from '@zeromttr/utils';

export interface Clock {
  now(): number;
  iso(): string;
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }

  public iso(): string {
    return nowIso();
  }
}
