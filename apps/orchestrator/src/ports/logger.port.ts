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
  public debug(_context: LogContext): void {
    // Intentional no-op
  }

  public info(_context: LogContext): void {
    // Intentional no-op
  }

  public warn(_context: LogContext): void {
    // Intentional no-op
  }

  public error(_context: LogContext): void {
    // Intentional no-op
  }
}
