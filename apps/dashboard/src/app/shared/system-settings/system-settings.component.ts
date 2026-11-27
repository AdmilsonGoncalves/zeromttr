import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isNonEmptyString, isNumber, parseNumber } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { Button } from 'primeng/button';
import { Drawer } from 'primeng/drawer';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { Tooltip } from 'primeng/tooltip';
import { DashboardApiErrorCode } from '../../core/constants.js';
import {
  SystemLogLevel,
  type SystemSettings,
  type SystemSettingsPatch
} from '../../core/contract.js';
import { I18nService } from '../../core/i18n/i18n.service.js';
import {
  SystemSettingsService,
  type SaveSettingsResult
} from '../../core/system-settings.service.js';

const SETTINGS_ADMIN_TOKEN_STORAGE_KEY = 'zeromttr_settings_admin_token';

/**
 * Production-ready Settings trigger (gear icon) and tabbed slide-over Drawer
 * protected by dedicated `X-Settings-Admin-Token` when configured.
 */
@Component({
  selector: 'app-system-settings',
  imports: [
    FormsModule,
    Drawer,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ToggleSwitch,
    Button,
    Tooltip
  ],
  templateUrl: './system-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SystemSettingsComponent {
  readonly i18n = inject(I18nService);
  readonly settingsService = inject(SystemSettingsService);
  readonly logLevels: readonly SystemLogLevel[] = Object.values(SystemLogLevel);

  readonly isDrawerOpenSignal = signal<boolean>(false);
  readonly demoModeEnabledSignal = signal<boolean>(true);
  readonly activeTabSignal = signal<string>('0');
  readonly adminTokenSignal = signal<string>('');
  readonly draftSignal = signal<SystemSettings | null>(null);
  readonly feedbackSignal = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  @Input()
  set demoModeEnabled(value: boolean) {
    this.demoModeEnabledSignal.set(value);
  }

  readonly isAutoRestoreControlDisabled = computed<boolean>(
    () => !this.settingsService.editable() || !this.demoModeEnabledSignal()
  );

  readonly pendingPatch = computed<SystemSettingsPatch>(() => {
    const saved = this.settingsService.settings();
    const draft = this.draftSignal();
    if (!saved || !draft) {
      return {};
    }

    const patch: Partial<Record<keyof SystemSettings, SystemSettings[keyof SystemSettings]>> = {};
    for (const key of Object.keys(draft) as Array<keyof SystemSettings>) {
      if (draft[key] !== saved[key]) {
        patch[key] = draft[key];
      }
    }
    return patch as SystemSettingsPatch;
  });

  readonly isDirty = computed<boolean>(() => Object.keys(this.pendingPatch()).length > 0);

  readonly canSave = computed<boolean>(() => {
    if (
      !this.settingsService.editable() ||
      !this.isDirty() ||
      this.settingsService.isSaving() ||
      this.settingsService.isLoading()
    ) {
      return false;
    }
    if (this.settingsService.requiresAuthKey() && !isNonEmptyString(this.adminTokenSignal())) {
      return false;
    }
    return true;
  });

  constructor() {
    try {
      const savedToken = globalThis.sessionStorage?.getItem(SETTINGS_ADMIN_TOKEN_STORAGE_KEY);
      if (isNonEmptyString(savedToken)) {
        this.adminTokenSignal.set(savedToken);
      }
    } catch {
      // Ignore storage access errors
    }
  }

  /**
   * Opens the Settings drawer and refreshes current values and change history from the server.
   */
  openDrawer(): void {
    this.isDrawerOpenSignal.set(true);
    this.feedbackSignal.set(null);
    void this.reloadSettings();
  }

  /**
   * Synchronizes drawer visibility changes from PrimeNG Drawer.
   */
  onDrawerVisibilityChange(visible: boolean): void {
    this.isDrawerOpenSignal.set(visible);
    if (!visible) {
      this.feedbackSignal.set(null);
    }
  }

  /**
   * Updates the active tab index inside the settings drawer.
   */
  onTabChange(value: string | number | undefined): void {
    if (value !== undefined) {
      this.activeTabSignal.set(String(value));
    }
  }

  /**
   * Stores the settings admin token in memory and sessionStorage for protected saves.
   */
  onAdminTokenChange(value: string): void {
    const next = value ?? '';
    this.adminTokenSignal.set(next);
    this.feedbackSignal.set(null);
    try {
      if (isNonEmptyString(next)) {
        globalThis.sessionStorage?.setItem(SETTINGS_ADMIN_TOKEN_STORAGE_KEY, next);
      } else {
        globalThis.sessionStorage?.removeItem(SETTINGS_ADMIN_TOKEN_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
  }

  /**
   * Reloads persisted settings from `/api/settings` and resets the local draft.
   */
  async reloadSettings(): Promise<void> {
    const ok = await this.settingsService.fetchSettings();
    const loaded = this.settingsService.settings();
    if (ok && loaded) {
      this.draftSignal.set({ ...loaded });
      this.feedbackSignal.set(null);
      return;
    }
    if (!ok && this.draftSignal()) {
      this.feedbackSignal.set({
        type: 'error',
        message: this.i18n.t('settingsLoadError')
      });
    }
  }

  /**
   * Updates a single field in the editable settings draft.
   */
  updateField<K extends keyof SystemSettings>(key: K, value: SystemSettings[K]): void {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    this.feedbackSignal.set(null);
    this.draftSignal.set({
      ...current,
      [key]: value
    });
  }

  /**
   * Parses and updates a numeric field from an HTML number input event.
   */
  updateNumberField(
    key:
      | 'rejectionCooldownSeconds'
      | 'repeatSuppressionSeconds'
      | 'decisionTtlSeconds'
      | 'targetErrorRateThresholdPercent',
    rawValue: unknown
  ): void {
    const parsed = parseNumber(rawValue, NaN);
    if (isNumber(parsed)) {
      this.updateField(key, parsed);
    }
  }

  /**
   * Persists only modified fields via `PATCH /api/settings` and shows inline feedback.
   */
  async saveChanges(): Promise<void> {
    if (!this.canSave()) {
      return;
    }

    const currentDraftBeforeSave = this.draftSignal();
    const submittedDraft = currentDraftBeforeSave ? { ...currentDraftBeforeSave } : null;
    const patch = this.pendingPatch();
    const result = await this.settingsService.saveSettings(patch, this.adminTokenSignal());
    if (result.ok) {
      const updated = this.settingsService.settings();
      if (updated) {
        const mergedDraft: SystemSettings = { ...updated };
        const latestDraft = this.draftSignal();
        if (submittedDraft && latestDraft) {
          for (const key of Object.keys(updated) as Array<keyof SystemSettings>) {
            if (latestDraft[key] !== submittedDraft[key]) {
              (mergedDraft as Record<string, unknown>)[key] = latestDraft[key];
            }
          }
        }
        this.draftSignal.set(mergedDraft);
      }
      this.feedbackSignal.set({
        type: 'success',
        message: this.i18n.t('settingsSavedSuccess')
      });
      return;
    }

    this.feedbackSignal.set({
      type: 'error',
      message: this.resolveSaveErrorMessage(result)
    });
  }

  private resolveSaveErrorMessage(result: SaveSettingsResult): string {
    if (result.errorCode === DashboardApiErrorCode.SETTINGS_READ_ONLY) {
      return this.i18n.t('settingsReadonlyNotice');
    }
    if (
      result.errorCode === DashboardApiErrorCode.SETTINGS_ADMIN_TOKEN_INVALID ||
      result.statusCode === HTTP_STATUS.FORBIDDEN ||
      result.statusCode === HTTP_STATUS.UNAUTHORIZED
    ) {
      return this.i18n.t('settingsInvalidAdminTokenError');
    }
    if (result.statusCode === HTTP_STATUS.BAD_REQUEST) {
      return this.i18n.t('settingsValidationError');
    }
    if (result.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return this.i18n.t('toastRateLimitDetail');
    }
    return this.i18n.t('settingsSaveError');
  }

  /**
   * Formats seconds into a concise human-friendly duration label (`0s`, `15m`, `1h 30m`).
   */
  formatDurationSeconds(seconds: number): string {
    if (!isNumber(seconds) || seconds <= 0) {
      return this.i18n.t('settingsDisabledValue');
    }
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const remSec = seconds % 60;
    if (mins < 60) {
      return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remMin = mins % 60;
    return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  }

  /**
   * Formats an ISO timestamp into a short readable UTC label for the audit log table.
   */
  formatAuditTimestamp(iso: string): string {
    if (!iso || iso.length < 19) {
      return iso;
    }
    return `${iso.slice(0, 19).replace('T', ' ')} UTC`;
  }
}
