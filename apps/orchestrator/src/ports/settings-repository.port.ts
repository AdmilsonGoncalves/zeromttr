import type { SettingsAuditEntry, SystemSettings, SystemSettingsPatch } from '@zeromttr/contracts';

export interface SettingsUpdateResult {
  settings: SystemSettings;
  changes: SettingsAuditEntry[];
}

export interface SettingsRepositoryPort {
  get(): SystemSettings;
  update(patch: SystemSettingsPatch, actor: string): SettingsUpdateResult;
  listAuditLog(limit?: number): SettingsAuditEntry[];
  close?(): void;
}
