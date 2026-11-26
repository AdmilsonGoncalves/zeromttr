import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SystemSettingsPatchSchema,
  SystemSettingsSchema,
  type SettingsAuditEntry,
  type SystemSettings,
  type SystemSettingsPatch
} from '@zeromttr/contracts';
import { clamp, isNonEmptyString, nowIso, safeJsonParse } from '@zeromttr/utils';
import { maskEmailForDisplay, resolveDefaultSystemSettings } from '../domain/system-settings.js';
import type {
  SettingsRepositoryPort,
  SettingsUpdateResult
} from '../ports/settings-repository.port.js';

interface SettingRow {
  key: string;
  value: string;
}

interface AuditRow {
  id: number;
  setting_key: string;
  old_value: string | null;
  new_value: string;
  actor: string;
  changed_at: string;
}

const DEFAULT_AUDIT_LIMIT = 25;
const MAX_AUDIT_LIMIT = 200;

function formatAuditValue(
  key: keyof SystemSettings,
  value: SystemSettings[keyof SystemSettings]
): string {
  if (key === 'onCallEmail') {
    return maskEmailForDisplay(String(value));
  }
  return String(value);
}

/**
 * SQLite-backed SettingsRepositoryPort storing runtime system settings and a full change audit trail.
 */
export class SqliteSettingsRepository implements SettingsRepositoryPort {
  private readonly db: DatabaseSync;
  private readonly defaults: SystemSettings;
  private current: SystemSettings;

  public constructor(
    dbPath: string = ':memory:',
    defaults: SystemSettings = resolveDefaultSystemSettings(process.env)
  ) {
    this.defaults = SystemSettingsSchema.parse(defaults);

    const normalizedPath = dbPath.trim() || ':memory:';
    if (normalizedPath !== ':memory:') {
      const dir = path.dirname(normalizedPath);
      if (isNonEmptyString(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(normalizedPath);
    if (normalizedPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        actor TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at
        ON settings_audit_log (id DESC);
    `);

    this.current = this.loadFromDatabase();
  }

  private loadFromDatabase(): SystemSettings {
    const rows = this.db
      .prepare('SELECT key, value FROM system_settings')
      .all() as unknown as SettingRow[];

    const merged: Record<string, unknown> = { ...this.defaults };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(this.defaults, row.key)) {
        const parsed = safeJsonParse<unknown>(row.value);
        if (parsed !== null) {
          merged[row.key] = parsed;
        }
      }
    }

    const validated = SystemSettingsSchema.safeParse(merged);
    return validated.success ? validated.data : { ...this.defaults };
  }

  /**
   * Returns the current validated system settings snapshot.
   */
  public get(): SystemSettings {
    return { ...this.current };
  }

  /**
   * Applies a validated partial settings patch atomically and appends per-key audit log entries.
   */
  public update(patch: SystemSettingsPatch, actor: string): SettingsUpdateResult {
    const validatedPatch = SystemSettingsPatchSchema.parse(patch);
    const previous = this.current;
    const next = SystemSettingsSchema.parse({
      ...previous,
      ...validatedPatch
    });

    const changedKeys = (Object.keys(validatedPatch) as Array<keyof SystemSettings>).filter(
      (key) => next[key] !== previous[key]
    );

    if (changedKeys.length === 0) {
      return {
        settings: this.get(),
        changes: []
      };
    }

    const safeActor = isNonEmptyString(actor) ? actor.trim() : 'system';
    const timestamp = nowIso();
    const upsertSetting = this.db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const insertAudit = this.db.prepare(`
      INSERT INTO settings_audit_log (setting_key, old_value, new_value, actor, changed_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const recordedChanges: SettingsAuditEntry[] = [];
    this.db.exec('BEGIN');
    try {
      for (const key of changedKeys) {
        const nextVal = next[key];
        const prevVal = previous[key];
        upsertSetting.run(key, JSON.stringify(nextVal), timestamp);
        const oldAuditVal = formatAuditValue(key, prevVal);
        const newAuditVal = formatAuditValue(key, nextVal);
        const result = insertAudit.run(key, oldAuditVal, newAuditVal, safeActor, timestamp);
        recordedChanges.push({
          id: Number(result.lastInsertRowid),
          settingKey: key,
          oldValue: oldAuditVal,
          newValue: newAuditVal,
          actor: safeActor,
          changedAt: timestamp
        });
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.current = next;
    return {
      settings: this.get(),
      changes: recordedChanges
    };
  }

  /**
   * Returns the most recent configuration change audit entries ordered newest-first.
   */
  public listAuditLog(limit = DEFAULT_AUDIT_LIMIT): SettingsAuditEntry[] {
    const safeLimit = clamp(Math.trunc(limit), 1, MAX_AUDIT_LIMIT);
    const rows = this.db
      .prepare(
        `
        SELECT id, setting_key, old_value, new_value, actor, changed_at
        FROM settings_audit_log
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(safeLimit) as unknown as AuditRow[];

    return rows.map((row) => ({
      id: Number(row.id),
      settingKey: row.setting_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      actor: row.actor,
      changedAt: row.changed_at
    }));
  }

  /**
   * Closes the underlying SQLite connection.
   */
  public close(): void {
    this.db.close();
  }
}
