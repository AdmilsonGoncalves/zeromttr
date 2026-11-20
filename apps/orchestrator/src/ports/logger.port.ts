import type { OrchestratorLogEvent } from '../domain/log-enums.js';

export interface LogContext {
  event: OrchestratorLogEvent | string;
  incidentId?: string;
  message?: string;
  [key: string]: unknown;
}

export interface LoggerPort {
  debug(context: LogContext): void;
  info(context: LogContext): void;
  warn(context: LogContext): void;
  error(context: LogContext): void;
}

export class NoopLogger implements LoggerPort {
  /**
   * Discards debug log messages.
   */
  public debug(_context: LogContext): void {
    // Intentional no-op
  }

  /**
   * Discards info log messages.
   */
  public info(_context: LogContext): void {
    // Intentional no-op
  }

  /**
   * Discards warn log messages.
   */
  public warn(_context: LogContext): void {
    // Intentional no-op
  }

  /**
   * Discards error log messages.
   */
  public error(_context: LogContext): void {
    // Intentional no-op
  }
}
