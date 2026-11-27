import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemLogLevel } from '@zeromttr/contracts';
import { SqliteSettingsRepository } from '../../src/adapters/settings.sqlite.js';
import {
  maskEmailForDisplay,
  resolveDefaultSystemSettings
} from '../../src/domain/system-settings.js';

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

  it('should_persist_settings_across_SQLite_restarts_and_record_change_audit_entries', () => {
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

  it('should_preserve_other_valid_persisted_keys_when_one_SQLite_row_is_invalid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-settings-partial-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'settings.sqlite');
    const defaults = resolveDefaultSystemSettings({
      TARGET_SERVICE_PATH: 'apps/target-app-demo'
    });

    const repo1 = new SqliteSettingsRepository(dbPath, defaults);
    repo1.update(
      {
        rejectionCooldownSeconds: 2400,
        llmModel: 'gemini-3.5-pro',
        logLevel: SystemLogLevel.WARN
      },
      'dashboard_operator'
    );
    repo1.close();

    // Simulate a schema evolution or corrupted single row in SQLite
    const rawDb = new DatabaseSync(dbPath);
    rawDb
      .prepare(
        `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run('onCallEmail', JSON.stringify('corrupted-not-an-email'), '2026-11-26T15:00:00.000Z');
    rawDb.close();

    const repo2 = new SqliteSettingsRepository(dbPath, defaults);
    const loaded = repo2.get();
    expect(loaded.onCallEmail).toBe(defaults.onCallEmail);
    expect(loaded.rejectionCooldownSeconds).toBe(2400);
    expect(loaded.llmModel).toBe('gemini-3.5-pro');
    expect(loaded.logLevel).toBe(SystemLogLevel.WARN);
    repo2.close();
  });

  it('should_preserve_valid_env_overrides_when_only_onCallEmail_env_is_invalid', () => {
    const resolved = resolveDefaultSystemSettings({
      ON_CALL_ENGINEER_EMAIL: 'not-a-valid-email',
      TARGET_SERVICE_PATH: 'services/checkout-api',
      TARGET_BASE_REF: 'v3.0.0',
      TARGET_HEAD_REF: 'v3.0.1',
      LLM_MODEL: 'gemini-3.5-pro',
      LLM_FALLBACK_MODEL: 'gemini-3.5-flash'
    });

    expect(resolved.onCallEmail).toBe('');
    expect(resolved.targetServicePath).toBe('services/checkout-api');
    expect(resolved.targetBaseRef).toBe('v3.0.0');
    expect(resolved.targetHeadRef).toBe('v3.0.1');
    expect(resolved.llmModel).toBe('gemini-3.5-pro');
    expect(resolved.llmFallbackModel).toBe('gemini-3.5-flash');
  });

  it('should_not_insert_audit_log_rows_when_patch_produces_no_effective_changes', () => {
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

  it('should_reject_invalid_patch_payloads_without_mutating_stored_settings', () => {
    const repo = new SqliteSettingsRepository(':memory:', resolveDefaultSystemSettings({}));

    expect(() =>
      repo.update({ targetServicePath: '../etc/passwd' }, 'dashboard_operator')
    ).toThrow();
    expect(repo.get().targetServicePath).toBe('apps/target-app-demo');
    expect(repo.listAuditLog()).toEqual([]);
    repo.close();
  });

  it('should_hide_at_least_one_character_when_masking_short_email_local_parts', () => {
    expect(maskEmailForDisplay('sre-team@example.com')).toBe('sr***@example.com');
    expect(maskEmailForDisplay('ab@example.com')).toBe('a***@example.com');
    expect(maskEmailForDisplay('a@example.com')).toBe('***@example.com');
    expect(maskEmailForDisplay('')).toBe('');
  });
});
