import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleJsonLogger } from '../../src/adapters/logger.console.js';
import { LogLevel, OrchestratorLogEvent } from '../../src/domain/index.js';

describe('ConsoleJsonLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should emit structured JSON logs with timestamp, level and event', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = new ConsoleJsonLogger(LogLevel.INFO);

    logger.info({
      event: OrchestratorLogEvent.ORCHESTRATOR_INITIALIZED,
      port: 8080
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(parsed.level).toBe(LogLevel.INFO);
    expect(parsed.event).toBe(OrchestratorLogEvent.ORCHESTRATOR_INITIALIZED);
    expect(parsed.port).toBe(8080);
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('should filter messages below the configured minimum log level', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new ConsoleJsonLogger(LogLevel.WARN);

    logger.debug({ event: 'debug_skipped' });
    logger.warn({ event: OrchestratorLogEvent.TRACE_ANALYSIS_FAILED, incidentId: 'inc-1' });

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should redact sensitive HMAC signatures, tokens, and secrets recursively', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = new ConsoleJsonLogger(LogLevel.DEBUG);

    logger.error({
      event: OrchestratorLogEvent.INCIDENT_STORE_SAVE_FAILED,
      sig: 'hmac-secret-sig',
      approveSig: 'approve-sig',
      rejectSig: 'reject-sig',
      nested: {
        token: 'Bearer xyz',
        apiKey: 'secret-key',
        authorization: 'Basic 123',
        safeField: 'visible'
      }
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(parsed.sig).toBe('[REDACTED]');
    expect(parsed.approveSig).toBe('[REDACTED]');
    expect(parsed.rejectSig).toBe('[REDACTED]');
    expect(parsed.nested.token).toBe('[REDACTED]');
    expect(parsed.nested.apiKey).toBe('[REDACTED]');
    expect(parsed.nested.authorization).toBe('[REDACTED]');
    expect(parsed.nested.safeField).toBe('visible');
  });

  it('should redact Bearer tokens and HMAC signatures embedded inside string messages', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new ConsoleJsonLogger(LogLevel.INFO);

    logger.warn({
      event: OrchestratorLogEvent.RESEND_NOTIFICATION_DEGRADED,
      message:
        'Upstream failed with Authorization: Bearer super-secret-jwt on https://dash/decision/1#action=approve&sig=deadbeef1234&exp=999'
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(parsed.message).not.toContain('super-secret-jwt');
    expect(parsed.message).not.toContain('deadbeef1234');
    expect(parsed.message).toContain('Bearer [REDACTED]');
    expect(parsed.message).toContain('sig=[REDACTED]');
  });
});
