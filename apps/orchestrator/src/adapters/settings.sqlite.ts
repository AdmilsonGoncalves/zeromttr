import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  SystemSettingsPatchSchema,
  SystemSettingsSchema,
  type SettingsAuditEntry,
  type SystemSettings,
  type SystemSettingsPatch
} from '@zeromttr/contracts';
import { clamp, isNonEmptyString, nowIso, safeJsonParse } from '@zeromttr/utils';
import { OrchestratorLogEvent } from '../domain/log-enums.js';
import { maskEmailForDisplay, resolveDefaultSystemSettings } from '../domain/system-settings.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type {
  SettingsRepositoryPort,
  SettingsUpdateResult
} from '../ports/settings-repository.port.js';

const SettingRowSchema = z.object({
  key: z.string(),
  value: z.string()
});

const AuditRowSchema = z.object({
  id: z.union([z.number(), z.bigint()]),
  setting_key: z.string(),
  old_value: z.string().nullable(),
  new_value: z.string(),
  actor: z.string(),
  changed_at: z.string()
});

const DEFAULT_AUDIT_LIMIT = 25;
const MAX_AUDIT_LIMIT = 200;
const META_LLM_PROVIDER_KEY = '_llmProvider';
const LLM_MODEL_KEYS: ReadonlyArray<'llmModel' | 'llmFallbackModel'> = [
  'llmModel',
  'llmFallbackModel'
];

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
  private readonly logger?: LoggerPort;
  private current: SystemSettings;
  private closed = false;

  public constructor(
    dbPath: string = ':memory:',
    defaults: SystemSettings = resolveDefaultSystemSettings(process.env),
    logger?: LoggerPort,
    activeLlmProvider?: string
  ) {
    this.defaults = SystemSettingsSchema.parse(defaults);
    this.logger = logger;

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
    `);

    if (isNonEmptyString(activeLlmProvider)) {
      this.reconcileLlmProviderChange(activeLlmProvider.trim().toLowerCase());
    }

    this.current = this.loadFromDatabase();
  }

  private reconcileLlmProviderChange(activeProvider: string): void {
    const storedRow = this.db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get(META_LLM_PROVIDER_KEY) as { value?: unknown } | undefined;

    const storedProvider =
      typeof storedRow?.value === 'string'
        ? safeJsonParse<string>(storedRow.value)?.trim().toLowerCase()
        : undefined;

    // Legacy databases without _llmProvider only existed when Gemini was the sole provider.
    const providerChanged = storedProvider
      ? storedProvider !== activeProvider
      : activeProvider !== 'gemini';

    const timestamp = nowIso();
    this.db.exec('BEGIN');
    try {
      if (providerChanged) {
        const selectKey = this.db.prepare('SELECT value FROM system_settings WHERE key = ?');
        const deleteKey = this.db.prepare('DELETE FROM system_settings WHERE key = ?');
        const insertAudit = this.db.prepare(`
          INSERT INTO settings_audit_log (setting_key, old_value, new_value, actor, changed_at)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const modelKey of LLM_MODEL_KEYS) {
          const existing = selectKey.get(modelKey) as { value?: unknown } | undefined;
          if (typeof existing?.value === 'string') {
            const oldParsed = safeJsonParse<string>(existing.value) ?? existing.value;
            deleteKey.run(modelKey);
            insertAudit.run(
              modelKey,
              String(oldParsed),
              this.defaults[modelKey],
              'system_provider_switch',
              timestamp
            );
          }
        }
      }

      if (storedProvider !== activeProvider) {
        this.db
          .prepare(
            `
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `
          )
          .run(META_LLM_PROVIDER_KEY, JSON.stringify(activeProvider), timestamp);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private loadFromDatabase(): SystemSettings {
    const rawRows = this.db.prepare('SELECT key, value FROM system_settings').all();
    const shape = SystemSettingsSchema.shape;
    const merged: Record<string, unknown> = { ...this.defaults };

    for (const rawRow of rawRows) {
      const parsedRow = SettingRowSchema.safeParse(rawRow);
      if (!parsedRow.success) {
        continue;
      }
      const { key, value } = parsedRow.data;
      if (!Object.prototype.hasOwnProperty.call(shape, key)) {
        continue;
      }
      const typedKey = key as keyof SystemSettings;
      const parsedJson = safeJsonParse<unknown>(value);
      if (parsedJson === null) {
        this.logger?.warn({
          event: OrchestratorLogEvent.SETTINGS_INVALID_PERSISTED_KEY,
          settingKey: typedKey,
          reason: 'Malformed JSON value in SQLite'
        });
        continue;
      }

      const fieldSchema = shape[typedKey];
      const fieldResult = fieldSchema.safeParse(parsedJson);
      if (fieldResult.success) {
        merged[typedKey] = fieldResult.data;
      } else {
        this.logger?.warn({
          event: OrchestratorLogEvent.SETTINGS_INVALID_PERSISTED_KEY,
          settingKey: typedKey,
          reason: 'Persisted value failed schema validation; using default for this key'
        });
      }
    }

    return SystemSettingsSchema.parse(merged);
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
    const rawRows = this.db
      .prepare(
        `
        SELECT id, setting_key, old_value, new_value, actor, changed_at
        FROM settings_audit_log
        ORDER BY id DESC
        LIMIT ?
      `
      )
      .all(safeLimit);

    const entries: SettingsAuditEntry[] = [];
    for (const rawRow of rawRows) {
      const parsed = AuditRowSchema.safeParse(rawRow);
      if (parsed.success) {
        entries.push({
          id: Number(parsed.data.id),
          settingKey: parsed.data.setting_key,
          oldValue: parsed.data.old_value,
          newValue: parsed.data.new_value,
          actor: parsed.data.actor,
          changedAt: parsed.data.changed_at
        });
      }
    }
    return entries;
  }

  /**
   * Closes the underlying SQLite connection idempotently.
   */
  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }
}
