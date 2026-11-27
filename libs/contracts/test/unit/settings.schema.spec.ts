import { describe, expect, it } from 'vitest';
import {
  SettingsPersistenceEngine,
  SystemLogLevel,
  SystemSettingsPatchSchema,
  SystemSettingsResponseSchema,
  SystemSettingsSchema
} from '../../src/settings/settings.schema.js';

const VALID_SETTINGS = {
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
  onCallEmail: 'oncall-sre@example.com',
  logLevel: SystemLogLevel.INFO
};

describe('SystemSettingsSchema', () => {
  it('should_accept_valid_full_settings_and_masked_email_response_payloads', () => {
    expect(SystemSettingsSchema.parse(VALID_SETTINGS)).toEqual(VALID_SETTINGS);

    const response = SystemSettingsResponseSchema.parse({
      settings: {
        ...VALID_SETTINGS,
        onCallEmail: 'on***@example.com'
      },
      readonlyInfo: {
        targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
        targetBaseBranch: 'release/target-v2.14.8',
        targetStatusProvider: 'manifest',
        grafanaRepeatInterval: '1m',
        persistenceEngine: SettingsPersistenceEngine.SQLITE
      },
      editable: true,
      requiresAuthKey: false,
      auditLog: [
        {
          id: 1,
          settingKey: 'rejectionCooldownSeconds',
          oldValue: '900',
          newValue: '1800',
          actor: 'dashboard_operator',
          changedAt: '2026-11-26T15:00:00.000Z'
        }
      ]
    });
    expect(response.readonlyInfo.persistenceEngine).toBe(SettingsPersistenceEngine.SQLITE);
    expect(response.settings.onCallEmail).toBe('on***@example.com');
  });

  it('should_allow_empty_string_for_onCallEmail_and_partial_patch_payloads', () => {
    const parsed = SystemSettingsPatchSchema.parse({
      onCallEmail: '',
      rejectionCooldownSeconds: 0
    });
    expect(parsed.onCallEmail).toBe('');
    expect(parsed.rejectionCooldownSeconds).toBe(0);
  });

  it.each([
    ['../etc/passwd'],
    ['/absolute/path'],
    ['apps\\windows\\path'],
    ['apps/../secret'],
    ['C:/outside'],
    ['d:/secret/path'],
    ['   ']
  ])('should_reject_unsafe_targetServicePath_%s', (unsafePath) => {
    const result = SystemSettingsPatchSchema.safeParse({ targetServicePath: unsafePath });
    expect(result.success).toBe(false);
  });

  it('should_accept_safe_git_refs_starting_with_underscore', () => {
    const parsed = SystemSettingsPatchSchema.parse({
      targetBaseRef: '_release',
      targetHeadRef: '_release-hotfix'
    });
    expect(parsed.targetBaseRef).toBe('_release');
    expect(parsed.targetHeadRef).toBe('_release-hotfix');
  });

  it('should_accept_short_masked_emails_in_response_schema', () => {
    const maxLenDomain = `${'a'.repeat(149)}.example`;
    const maxMaskedEmail = `a***@${maxLenDomain}`;
    expect(maxMaskedEmail.length).toBe(162);

    for (const maskedEmail of ['a***@example.com', '***@example.com', maxMaskedEmail]) {
      const result = SystemSettingsResponseSchema.safeParse({
        settings: {
          ...VALID_SETTINGS,
          onCallEmail: maskedEmail
        },
        readonlyInfo: {
          targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
          targetBaseBranch: 'release/target-v2.14.8',
          targetStatusProvider: 'manifest',
          grafanaRepeatInterval: '1m',
          persistenceEngine: SettingsPersistenceEngine.SQLITE
        },
        editable: true,
        requiresAuthKey: false,
        auditLog: []
      });
      expect(result.success).toBe(true);
    }
  });

  it.each([
    ['--no-patch'],
    ['-v2.14.7'],
    ['v2.14.7..v2.14.8'],
    ['release/'],
    ['refs/heads/main.lock']
  ])('should_reject_unsafe_git_ref_%s', (unsafeRef) => {
    expect(SystemSettingsPatchSchema.safeParse({ targetBaseRef: unsafeRef }).success).toBe(false);
    expect(SystemSettingsPatchSchema.safeParse({ targetHeadRef: unsafeRef }).success).toBe(false);
  });

  it('should_reject_unknown_keys_and_out_of_range_cooldown_or_threshold_values', () => {
    expect(SystemSettingsPatchSchema.safeParse({ unknownField: true }).success).toBe(false);
    expect(SystemSettingsPatchSchema.safeParse({ decisionTtlSeconds: 10 }).success).toBe(false);
    expect(SystemSettingsPatchSchema.safeParse({ rejectionCooldownSeconds: -1 }).success).toBe(
      false
    );
    expect(
      SystemSettingsPatchSchema.safeParse({ targetErrorRateThresholdPercent: 120 }).success
    ).toBe(false);
    expect(SystemSettingsPatchSchema.safeParse({ onCallEmail: 'not-an-email' }).success).toBe(
      false
    );
  });
});
