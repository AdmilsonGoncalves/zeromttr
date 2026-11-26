import { z } from 'zod';

export const SystemLogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
} as const;
export type SystemLogLevel = (typeof SystemLogLevel)[keyof typeof SystemLogLevel];
export const SystemLogLevelSchema = z.nativeEnum(SystemLogLevel);

export const SettingsPersistenceEngine = {
  SQLITE: 'sqlite'
} as const;
export type SettingsPersistenceEngine =
  (typeof SettingsPersistenceEngine)[keyof typeof SettingsPersistenceEngine];

const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/~^-]*$/;
const SAFE_MODEL_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MASKED_EMAIL_PATTERN = /^[^@\s]{0,2}\*{3}@[^@\s]+\.[^@\s]+$/;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;

function isSafeGitRef(value: string): boolean {
  const trimmed = value.trim();
  if (!SAFE_GIT_REF_PATTERN.test(trimmed)) {
    return false;
  }
  if (trimmed.includes('..') || trimmed.endsWith('/') || trimmed.endsWith('.lock')) {
    return false;
  }
  return true;
}

function isSafeRepoRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('/') ||
    trimmed.includes('\\') ||
    WINDOWS_DRIVE_PREFIX_PATTERN.test(trimmed)
  ) {
    return false;
  }
  if (trimmed.includes('\0')) {
    return false;
  }
  const segments = trimmed.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export const SystemSettingsSchema = z.object({
  // Alerts & Cooldowns
  rejectionCooldownSeconds: z.number().int().min(0).max(86_400),
  repeatSuppressionSeconds: z.number().int().min(0).max(86_400),
  decisionTtlSeconds: z.number().int().min(60).max(86_400),
  autoRestoreOnApprove: z.boolean(),

  // Target & Deploy Diff
  targetServicePath: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(isSafeRepoRelativePath, 'targetServicePath must be a safe relative repository path'),
  targetBaseRef: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(isSafeGitRef, 'targetBaseRef contains invalid characters'),
  targetHeadRef: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(isSafeGitRef, 'targetHeadRef contains invalid characters'),
  targetErrorRateThresholdPercent: z.number().min(0.1).max(100),

  // LLM & Operations
  llmModel: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(SAFE_MODEL_NAME_PATTERN, 'llmModel contains invalid characters'),
  llmFallbackModel: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(SAFE_MODEL_NAME_PATTERN, 'llmFallbackModel contains invalid characters'),
  onCallEmail: z.union([z.literal(''), z.string().trim().email().max(160)]),
  logLevel: SystemLogLevelSchema
});
export type SystemSettings = z.infer<typeof SystemSettingsSchema>;

export const SystemSettingsPatchSchema = SystemSettingsSchema.partial().strict();
export type SystemSettingsPatch = z.infer<typeof SystemSettingsPatchSchema>;

export const SettingsAuditEntrySchema = z.object({
  id: z.number().int().positive(),
  settingKey: z.string().min(1),
  oldValue: z.string().nullable(),
  newValue: z.string(),
  actor: z.string().min(1),
  changedAt: z.string().min(1)
});
export type SettingsAuditEntry = z.infer<typeof SettingsAuditEntrySchema>;

export const SystemSettingsReadonlyInfoSchema = z.object({
  targetGithubRepo: z.string(),
  targetBaseBranch: z.string(),
  targetStatusProvider: z.string(),
  grafanaRepeatInterval: z.string(),
  persistenceEngine: z.nativeEnum(SettingsPersistenceEngine)
});
export type SystemSettingsReadonlyInfo = z.infer<typeof SystemSettingsReadonlyInfoSchema>;

export const DisplayOnCallEmailSchema = z.union([
  z.literal(''),
  z.literal('***'),
  z.string().trim().email().max(160),
  z.string().trim().max(160).regex(MASKED_EMAIL_PATTERN)
]);

export const SystemSettingsDisplaySchema = SystemSettingsSchema.extend({
  onCallEmail: DisplayOnCallEmailSchema
});
export type SystemSettingsDisplay = z.infer<typeof SystemSettingsDisplaySchema>;

export const SystemSettingsResponseSchema = z.object({
  settings: SystemSettingsDisplaySchema,
  readonlyInfo: SystemSettingsReadonlyInfoSchema,
  editable: z.boolean(),
  requiresAuthKey: z.boolean(),
  auditLog: z.array(SettingsAuditEntrySchema)
});
export type SystemSettingsResponse = z.infer<typeof SystemSettingsResponseSchema>;
