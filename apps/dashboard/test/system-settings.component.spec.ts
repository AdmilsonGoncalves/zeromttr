import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SettingsPersistenceEngine,
  SystemLogLevel,
  type SystemSettingsResponse
} from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n/i18n.service.js';
import { SystemSettingsService } from '../src/app/core/system-settings.service.js';
import { SystemSettingsComponent } from '../src/app/shared/system-settings/system-settings.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETTINGS_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/shared/system-settings/system-settings.component.html'
);

const MOCK_RESPONSE: SystemSettingsResponse = {
  settings: {
    rejectionCooldownSeconds: 900,
    repeatSuppressionSeconds: 60,
    decisionTtlSeconds: 900,
    autoRestoreOnApprove: true,
    targetServicePath: 'apps/target-app-demo',
    targetBaseRef: 'v2.14.7',
    targetHeadRef: 'v2.14.8',
    targetErrorRateThresholdPercent: 5,
    llmModel: 'gemini-3.5-flash',
    llmFallbackModel: 'gemini-3.5-flash-lite',
    onCallEmail: 'on***@example.com',
    logLevel: SystemLogLevel.INFO
  },
  readonlyInfo: {
    targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
    targetBaseBranch: 'release/target-v2.14.8',
    targetStatusProvider: 'manifest',
    grafanaRepeatInterval: '1m',
    persistenceEngine: SettingsPersistenceEngine.SQLITE
  },
  editable: true,
  requiresAuthKey: true,
  auditLog: []
};

describe('SystemSettingsComponent', () => {
  let i18n: I18nService;
  let service: SystemSettingsService;
  let component: SystemSettingsComponent;

  beforeEach(() => {
    i18n = new I18nService();
    service = new SystemSettingsService();
    component = new SystemSettingsComponent(i18n, service);
  });

  it('should_require_admin_token_when_requiresAuthKey_is_true_and_send_only_modified_fields_on_save', async () => {
    vi.spyOn(service, 'fetchSettings').mockImplementation(async () => {
      service.settings.set({ ...MOCK_RESPONSE.settings });
      service.readonlyInfo.set({ ...MOCK_RESPONSE.readonlyInfo });
      service.editable.set(true);
      service.requiresAuthKey.set(true);
      service.auditLog.set([]);
      return true;
    });

    const saveSpy = vi.spyOn(service, 'saveSettings').mockResolvedValue({
      ok: true,
      statusCode: 200
    });

    component.openDrawer();
    await Promise.resolve();

    component.updateNumberField('rejectionCooldownSeconds', 1800);
    component.updateField('logLevel', SystemLogLevel.DEBUG);

    // Without admin token, save stays disabled
    expect(component.isDirty()).toBe(true);
    expect(component.canSave()).toBe(false);

    // Providing SETTINGS_ADMIN_TOKEN unlocks save
    component.onAdminTokenChange('settings-admin-secret');
    expect(component.canSave()).toBe(true);

    await component.saveChanges();
    expect(saveSpy).toHaveBeenCalledWith(
      {
        rejectionCooldownSeconds: 1800,
        logLevel: SystemLogLevel.DEBUG
      },
      'settings-admin-secret'
    );
    expect(component.feedbackSignal()?.type).toBe('success');
  });

  it('should_block_saving_when_settings_are_read_only', async () => {
    vi.spyOn(service, 'fetchSettings').mockImplementation(async () => {
      service.settings.set({ ...MOCK_RESPONSE.settings });
      service.readonlyInfo.set({ ...MOCK_RESPONSE.readonlyInfo });
      service.editable.set(false);
      service.requiresAuthKey.set(false);
      service.auditLog.set([]);
      return true;
    });

    component.openDrawer();
    await Promise.resolve();

    component.updateNumberField('rejectionCooldownSeconds', 1200);
    expect(component.canSave()).toBe(false);
  });

  it('should_display_localized_error_messages_for_invalid_token_read_only_validation_and_rate_limit', async () => {
    vi.spyOn(service, 'fetchSettings').mockImplementation(async () => {
      service.settings.set({ ...MOCK_RESPONSE.settings });
      service.readonlyInfo.set({ ...MOCK_RESPONSE.readonlyInfo });
      service.editable.set(true);
      service.requiresAuthKey.set(true);
      service.auditLog.set([]);
      return true;
    });

    component.openDrawer();
    await Promise.resolve();
    component.onAdminTokenChange('wrong-token');
    component.updateNumberField('rejectionCooldownSeconds', 1200);

    const saveSpy = vi.spyOn(service, 'saveSettings').mockResolvedValueOnce({
      ok: false,
      statusCode: 403,
      errorCode: 'SETTINGS_ADMIN_TOKEN_INVALID',
      error: 'Forbidden: Valid X-Settings-Admin-Token required'
    });
    await component.saveChanges();
    expect(component.feedbackSignal()).toEqual({
      type: 'error',
      message: i18n.t('settingsInvalidAdminTokenError')
    });

    saveSpy.mockResolvedValueOnce({
      ok: false,
      statusCode: 403,
      errorCode: 'SETTINGS_READ_ONLY',
      error: 'System settings are read-only'
    });
    await component.saveChanges();
    expect(component.feedbackSignal()).toEqual({
      type: 'error',
      message: i18n.t('settingsReadonlyNotice')
    });

    saveSpy.mockResolvedValueOnce({
      ok: false,
      statusCode: 400,
      error: 'Invalid payload'
    });
    await component.saveChanges();
    expect(component.feedbackSignal()).toEqual({
      type: 'error',
      message: i18n.t('settingsValidationError')
    });

    saveSpy.mockResolvedValueOnce({
      ok: false,
      statusCode: 429,
      error: 'Rate limit exceeded'
    });
    await component.saveChanges();
    expect(component.feedbackSignal()).toEqual({
      type: 'error',
      message: i18n.t('toastRateLimitDetail')
    });
  });

  it('should_format_duration_labels_concisely_across_seconds_minutes_and_hours', () => {
    expect(component.formatDurationSeconds(0)).toBe(i18n.t('settingsDisabledValue'));
    expect(component.formatDurationSeconds(45)).toBe('45s');
    expect(component.formatDurationSeconds(900)).toBe('15m');
    expect(component.formatDurationSeconds(5400)).toBe('1h 30m');
  });

  it('should_render_gear_trigger_admin_token_input_tabbed_drawer_and_error_fallback_without_SQLite_jargon', () => {
    const html = readFileSync(SETTINGS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('pi-cog');
    expect(html).toContain('<p-drawer');
    expect(html).toContain('<p-tabs');
    expect(html).toContain('settings-admin-token-input');
    expect(html).toContain('settingsReadonlyNotice');
    expect(html).toContain('@else {');
    expect(html).toContain('settingsService.lastError()');
    expect(html).not.toContain('SQLite');
    expect(i18n.t('tooltipSystemSettings')).toBe('Configurações');
    expect(i18n.t('settingsDrawerTitle')).toBe('Configurações');
    expect(i18n.t('settingsDrawerSubtitle')).not.toContain('SQLite');
    expect(i18n.t('settingsOnCallEmailHint')).toContain('ON_CALL_ENGINEER_EMAIL');
  });
});
