import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemLogLevel } from '@zeromttr/contracts';
import { SqliteSettingsRepository } from '../../src/adapters/settings.sqlite.js';
import { resolveDefaultSystemSettings } from '../../src/domain/system-settings.js';

describe('SqliteSettingsRepository', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('should persist settings across SQLite restarts and record change audit entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-settings-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'settings.sqlite');

    const defaults = resolveDefaultSystemSettings({
      ENABLE_DEMO_MODE: 'true',
      TARGET_SERVICE_PATH: 'apps/target-app-demo'
    });

    const repo1 = new SqliteSettingsRepository(dbPath, defaults);
    expect(repo1.get().rejectionCooldownSeconds).toBe(900);
    expect(repo1.listAuditLog()).toEqual([]);

    const updated = repo1.update(
      {
        rejectionCooldownSeconds: 1800,
        logLevel: SystemLogLevel.DEBUG,
        onCallEmail: 'sre-team@example.com'
      },
      'dashboard_operator'
    );

    expect(updated.settings.rejectionCooldownSeconds).toBe(1800);
    expect(updated.settings.logLevel).toBe(SystemLogLevel.DEBUG);
    expect(updated.settings.onCallEmail).toBe('sre-team@example.com');
    expect(updated.changes).toHaveLength(3);

    const emailAudit = updated.changes.find((entry) => entry.settingKey === 'onCallEmail');
    expect(emailAudit?.newValue).toBe('sr***@example.com');

    repo1.close();

    // Reopen from disk and verify persistence + audit log order
    const repo2 = new SqliteSettingsRepository(dbPath, defaults);
    expect(repo2.get().rejectionCooldownSeconds).toBe(1800);
    expect(repo2.get().logLevel).toBe(SystemLogLevel.DEBUG);
    expect(repo2.get().onCallEmail).toBe('sre-team@example.com');

    const audit = repo2.listAuditLog(10);
    expect(audit).toHaveLength(3);
    expect(audit[0].id).toBeGreaterThan(audit[2].id);
    repo2.close();
  });

  it('should not insert audit log rows when patch produces no effective changes', () => {
    const repo = new SqliteSettingsRepository(':memory:', resolveDefaultSystemSettings({}));
    const current = repo.get();

    const result = repo.update(
      {
        rejectionCooldownSeconds: current.rejectionCooldownSeconds,
        logLevel: current.logLevel
      },
      'dashboard_operator'
    );

    expect(result.changes).toEqual([]);
    expect(repo.listAuditLog()).toEqual([]);
    repo.close();
  });

  it('should reject invalid patch payloads without mutating stored settings', () => {
    const repo = new SqliteSettingsRepository(':memory:', resolveDefaultSystemSettings({}));

    expect(() =>
      repo.update({ targetServicePath: '../etc/passwd' }, 'dashboard_operator')
    ).toThrow();
    expect(repo.get().targetServicePath).toBe('apps/target-app-demo');
    expect(repo.listAuditLog()).toEqual([]);
    repo.close();
  });
});
