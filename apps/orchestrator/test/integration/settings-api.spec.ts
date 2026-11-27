import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  SettingsPersistenceEngine,
  SystemLogLevel,
  SystemSettingsResponseSchema
} from '@zeromttr/contracts';
import { HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { SqliteSettingsRepository } from '../../src/adapters/settings.sqlite.js';
import { resolveDefaultSystemSettings } from '../../src/domain/system-settings.js';
import { createDashboardAuthMiddleware } from '../../src/http/auth.js';
import { createSettingsRouter } from '../../src/http/settings.controller.js';

const DASHBOARD_TOKEN = 'test-dashboard-token';
const SETTINGS_ADMIN_TOKEN = 'test-settings-admin-token';

const READONLY_INFO = {
  targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
  targetBaseBranch: 'release/target-v2.14.8',
  targetStatusProvider: 'manifest',
  grafanaRepeatInterval: '1m',
  persistenceEngine: SettingsPersistenceEngine.SQLITE
} as const;

function createTestServer(options: { editable?: boolean; requiresAuthKey?: boolean } = {}) {
  const settingsRepository = new SqliteSettingsRepository(
    ':memory:',
    resolveDefaultSystemSettings({
      ON_CALL_ENGINEER_EMAIL: 'oncall-sre@example.com',
      ENABLE_DEMO_MODE: 'true'
    })
  );
  const onSettingsUpdated = vi.fn();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createSettingsRouter({
      settingsRepository,
      dashboardAuthMiddleware: createDashboardAuthMiddleware(DASHBOARD_TOKEN),
      readonlyInfo: READONLY_INFO,
      editable: options.editable ?? true,
      requiresAuthKey: options.requiresAuthKey ?? false,
      adminToken: SETTINGS_ADMIN_TOKEN,
      onSettingsUpdated,
      logger
    })
  );
  return { app, settingsRepository, onSettingsUpdated, logger };
}

describe('System Settings REST API (/api/settings)', () => {
  it('should_always_mask_onCallEmail_on_GET_settings_and_match_response_schema', async () => {
    const { app, settingsRepository } = createTestServer();

    const res = await request(app)
      .get('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`);

    expect(res.status).toBe(HTTP_STATUS.OK);
    const parsed = SystemSettingsResponseSchema.parse(res.body);
    expect(parsed.settings.rejectionCooldownSeconds).toBe(900);
    expect(parsed.settings.onCallEmail).toBe('on***@example.com');
    expect(parsed.readonlyInfo.persistenceEngine).toBe(SettingsPersistenceEngine.SQLITE);
    expect(parsed.auditLog).toEqual([]);
    settingsRepository.close();
  });

  it('should_persist_valid_PATCH_updates_to_SQLite_invoke_hook_and_append_audit_log', async () => {
    const { app, settingsRepository, onSettingsUpdated } = createTestServer();

    const res = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({
        rejectionCooldownSeconds: 1800,
        repeatSuppressionSeconds: 120,
        targetServicePath: 'services/checkout-api',
        logLevel: SystemLogLevel.WARN
      });

    expect(res.status).toBe(HTTP_STATUS.OK);
    const parsed = SystemSettingsResponseSchema.parse(res.body);
    expect(parsed.settings.rejectionCooldownSeconds).toBe(1800);
    expect(parsed.settings.repeatSuppressionSeconds).toBe(120);
    expect(parsed.settings.targetServicePath).toBe('services/checkout-api');
    expect(parsed.settings.logLevel).toBe(SystemLogLevel.WARN);
    expect(parsed.auditLog).toHaveLength(4);
    expect(onSettingsUpdated).toHaveBeenCalledTimes(1);
    settingsRepository.close();
  });

  it('should_return_400_Bad_Request_for_invalid_path_traversal_or_out_of_range_fields', async () => {
    const { app, settingsRepository } = createTestServer();
    const initialSettings = settingsRepository.get();

    const invalidPathRes = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ targetServicePath: '../../etc/passwd' });

    expect(invalidPathRes.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(settingsRepository.get()).toEqual(initialSettings);
    expect(settingsRepository.listAuditLog()).toEqual([]);

    const invalidTtlRes = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ decisionTtlSeconds: 5 });

    expect(invalidTtlRes.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(settingsRepository.get()).toEqual(initialSettings);
    expect(settingsRepository.listAuditLog()).toEqual([]);
    settingsRepository.close();
  });

  it('should_enforce_X_Settings_Admin_Token_on_PATCH_when_requiresAuthKey_is_true', async () => {
    const { app, settingsRepository } = createTestServer({ requiresAuthKey: true });

    const deniedMissing = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ rejectionCooldownSeconds: 600 });
    expect(deniedMissing.status).toBe(HTTP_STATUS.FORBIDDEN);

    const deniedWrongHeader = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .set(HTTP_HEADERS.LIVE_DEMO_KEY, SETTINGS_ADMIN_TOKEN)
      .send({ rejectionCooldownSeconds: 600 });
    expect(deniedWrongHeader.status).toBe(HTTP_STATUS.FORBIDDEN);

    const allowed = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .set(HTTP_HEADERS.SETTINGS_ADMIN_TOKEN, SETTINGS_ADMIN_TOKEN)
      .send({ rejectionCooldownSeconds: 600 });
    expect(allowed.status).toBe(HTTP_STATUS.OK);
    expect(allowed.body.settings.rejectionCooldownSeconds).toBe(600);
    settingsRepository.close();
  });

  it('should_reject_PATCH_with_403_Forbidden_when_settings_are_read_only', async () => {
    const { app, settingsRepository } = createTestServer({ editable: false });

    const res = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ rejectionCooldownSeconds: 600 });

    expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    settingsRepository.close();
  });

  it('should_return_structured_JSON_500_when_settings_repository_throws_SQLite_error', async () => {
    const { app, settingsRepository, logger } = createTestServer();
    vi.spyOn(settingsRepository, 'get').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    const getRes = await request(app)
      .get('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`);
    expect(getRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(getRes.headers['content-type']).toContain('application/json');
    expect(getRes.body.error).toBe('Failed to read system settings');
    expect(getRes.body.error).not.toContain('SQLITE_BUSY');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'settings_read_failed',
        message: 'SQLITE_BUSY: database is locked'
      })
    );

    vi.spyOn(settingsRepository, 'update').mockImplementationOnce(() => {
      throw new Error('SQLITE_READONLY: attempt to write a readonly database');
    });

    const patchRes = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ rejectionCooldownSeconds: 1200 });
    expect(patchRes.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(patchRes.headers['content-type']).toContain('application/json');
    expect(patchRes.body.error).toBe('Failed to persist system settings');
    expect(patchRes.body.error).not.toContain('SQLITE_READONLY');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'settings_persist_failed',
        message: 'SQLITE_READONLY: attempt to write a readonly database'
      })
    );
    settingsRepository.close();
  });
});
