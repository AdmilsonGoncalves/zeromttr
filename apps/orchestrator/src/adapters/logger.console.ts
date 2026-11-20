import { isArray, isObject, isString, nowIso } from '@zeromttr/utils';
import { LogLevel } from '../domain/log-enums.js';
import type { LogContext, LoggerPort } from '../ports/logger.port.js';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40
};

const SENSITIVE_KEYS = new Set([
  'sig',
  'approvesig',
  'rejectsig',
  'token',
  'secret',
  'apikey',
  'authorization',
  'password'
]);

const REDACTED_VALUE = '[REDACTED]';

function sanitizeLogString(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/([#&?](?:sig|approveSig|rejectSig|token|apiKey|secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

function resolveMinLevel(rawLevel?: string): LogLevel {
  const normalized = (rawLevel ?? '').trim().toLowerCase();
  for (const level of Object.values(LogLevel)) {
    if (level === normalized) {
      return level;
    }
  }
  return LogLevel.INFO;
}

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return value.map((item) => redactValue(item, seen));
  }

  if (isObject(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const sanitized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = REDACTED_VALUE;
      } else {
        sanitized[key] = redactValue(entryValue, seen);
      }
    }
    return sanitized;
  }

  if (isString(value)) {
    return sanitizeLogString(value);
  }

  return value;
}

export class ConsoleJsonLogger implements LoggerPort {
  private readonly minLevel: LogLevel;

  public constructor(minLevel?: LogLevel | string) {
    this.minLevel = resolveMinLevel(minLevel ?? process.env.LOG_LEVEL);
  }

  public debug(context: LogContext): void {
    this.write(LogLevel.DEBUG, context);
  }

  public info(context: LogContext): void {
    this.write(LogLevel.INFO, context);
  }

  public warn(context: LogContext): void {
    this.write(LogLevel.WARN, context);
  }

  public error(context: LogContext): void {
    this.write(LogLevel.ERROR, context);
  }

  private write(level: LogLevel, context: LogContext): void {
    if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[this.minLevel]) {
      return;
    }

    const { event, ...rest } = context;
    const redactedRest = redactValue(rest);
    const extraFields = isObject(redactedRest) ? redactedRest : {};

    const payload = JSON.stringify({
      timestamp: nowIso(),
      level,
      event,
      ...extraFields
    });

    if (level === LogLevel.ERROR) {
      console.error(payload);
    } else if (level === LogLevel.WARN) {
      console.warn(payload);
    } else if (level === LogLevel.DEBUG) {
      console.debug(payload);
    } else {
      console.info(payload);
    }
  }
}
