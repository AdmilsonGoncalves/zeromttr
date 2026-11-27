import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockServer, type MockServer } from '../../mock-server/server.js';
import { SystemLogLevel } from '../../src/app/core/contract.js';
import { SystemSettingsService } from '../../src/app/core/system-settings.service.js';

describe('SystemSettingsService', () => {
  let server: MockServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createMockServer({ heartbeatIntervalMs: 500 });
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should_fetch_settings_and_populate_reactive_signals_from_API', async () => {
    const service = new SystemSettingsService();
    const ok = await service.fetchSettings(baseUrl);

    expect(ok).toBe(true);
    expect(service.isLoading()).toBe(false);
    expect(service.lastError()).toBeNull();
    expect(service.settings()?.onCallEmail).toBe('on***@example.com');
    expect(service.readonlyInfo()?.targetStatusProvider).toBe('manifest');
    expect(service.editable()).toBe(true);
    expect(service.requiresAuthKey()).toBe(false);
  });

  it('should_send_PATCH_with_X_Settings_Admin_Token_header_and_refresh_audit_log', async () => {
    const service = new SystemSettingsService();
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      return realFetch(input, init);
    });

    const result = await service.saveSettings(
      { rejectionCooldownSeconds: 1800, logLevel: SystemLogLevel.DEBUG },
      '  admin-secret-token  ',
      baseUrl
    );

    expect(result).toEqual({ ok: true, statusCode: 200 });
    expect(service.isSaving()).toBe(false);
    expect(service.settings()?.rejectionCooldownSeconds).toBe(1800);
    expect(service.settings()?.logLevel).toBe(SystemLogLevel.DEBUG);
    expect(service.auditLog().length).toBeGreaterThanOrEqual(1);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;
    expect(init?.method).toBe('PATCH');
    expect(headers['X-Settings-Admin-Token']).toBe('admin-secret-token');
  });

  it('should_parse_structured_error_codes_and_handle_non_JSON_or_network_failures', async () => {
    const service = new SystemSettingsService();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'SETTINGS_ADMIN_TOKEN_INVALID',
          error: 'Forbidden: Valid X-Settings-Admin-Token required'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const forbidden = await service.saveSettings({ rejectionCooldownSeconds: 300 }, 'bad-key');
    expect(forbidden).toEqual({
      ok: false,
      statusCode: 403,
      errorCode: 'SETTINGS_ADMIN_TOKEN_INVALID',
      error: 'Forbidden: Valid X-Settings-Admin-Token required'
    });
    expect(service.lastError()).toBe('Forbidden: Valid X-Settings-Admin-Token required');
    expect(service.isSaving()).toBe(false);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>502 Bad Gateway</html>', { status: 502 })
    );
    const nonJson = await service.saveSettings({ rejectionCooldownSeconds: 300 });
    expect(nonJson).toEqual({
      ok: false,
      statusCode: 502,
      errorCode: undefined,
      error: 'HTTP 502'
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network offline'));
    const fetchFailed = await service.fetchSettings();
    expect(fetchFailed).toBe(false);
    expect(service.lastError()).toBe('network offline');
    expect(service.isLoading()).toBe(false);
  });
});
