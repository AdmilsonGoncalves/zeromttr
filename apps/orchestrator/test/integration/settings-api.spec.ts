import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPersistenceEngine, SystemLogLevel } from '@zeromttr/contracts';
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
      onSettingsUpdated
    })
  );
  return { app, settingsRepository, onSettingsUpdated };
}

describe('System Settings REST API (/api/settings)', () => {
  it('should always mask onCallEmail on GET /api/settings and return readonly info', async () => {
    const { app, settingsRepository } = createTestServer();

    const res = await request(app)
      .get('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`);

    expect(res.status).toBe(HTTP_STATUS.OK);
    expect(res.body.settings.rejectionCooldownSeconds).toBe(900);
    expect(res.body.settings.onCallEmail).toBe('on***@example.com');
    expect(res.body.readonlyInfo.persistenceEngine).toBe(SettingsPersistenceEngine.SQLITE);
    expect(res.body.auditLog).toEqual([]);
    settingsRepository.close();
  });

  it('should persist valid PATCH updates to SQLite, invoke hook, and append audit log', async () => {
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
    expect(res.body.settings.rejectionCooldownSeconds).toBe(1800);
    expect(res.body.settings.repeatSuppressionSeconds).toBe(120);
    expect(res.body.settings.targetServicePath).toBe('services/checkout-api');
    expect(res.body.settings.logLevel).toBe(SystemLogLevel.WARN);
    expect(res.body.auditLog).toHaveLength(4);
    expect(onSettingsUpdated).toHaveBeenCalledTimes(1);
    settingsRepository.close();
  });

  it('should return 400 Bad Request for invalid path traversal or out-of-range fields', async () => {
    const { app, settingsRepository } = createTestServer();

    const res = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({
        targetServicePath: '../../etc/passwd',
        decisionTtlSeconds: 5
      });

    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(settingsRepository.listAuditLog()).toEqual([]);
    settingsRepository.close();
  });

  it('should enforce X-Settings-Admin-Token on PATCH when requiresAuthKey is true', async () => {
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

  it('should reject PATCH with 403 Forbidden when settings are read-only', async () => {
    const { app, settingsRepository } = createTestServer({ editable: false });

    const res = await request(app)
      .patch('/api/settings')
      .set(HTTP_HEADERS.AUTHORIZATION, `Bearer ${DASHBOARD_TOKEN}`)
      .send({ rejectionCooldownSeconds: 600 });

    expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
    settingsRepository.close();
  });
});
