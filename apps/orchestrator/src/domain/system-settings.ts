import type { z } from 'zod';
import { SystemLogLevel, SystemSettingsSchema, type SystemSettings } from '@zeromttr/contracts';
import { isNonEmptyString, parseNumber } from '@zeromttr/utils';
import { OrchestratorDefault } from './incident-enums.js';

const DEFAULT_REJECTION_COOLDOWN_SECONDS = 900;
const DEFAULT_REPEAT_SUPPRESSION_SECONDS = 60;
const DEFAULT_DECISION_TTL_SECONDS = 900;
const DEFAULT_ERROR_RATE_THRESHOLD_PERCENT = 5;
const DEFAULT_SERVICE_PATH = 'apps/target-app-demo';
const DEFAULT_LLM_MODEL = 'gemini-3.5-flash';
const DEFAULT_LLM_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

function parseOptionalBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!isNonEmptyString(raw)) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return fallback;
}

function resolveLogLevel(raw?: string): SystemLogLevel {
  const normalized = (raw ?? '').trim().toLowerCase();
  for (const level of Object.values(SystemLogLevel)) {
    if (level === normalized) {
      return level;
    }
  }
  return SystemLogLevel.INFO;
}

function resolveSchemaField<T>(schema: z.ZodType<T>, candidate: unknown, fallback: T): T {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  return fallback;
}

/**
 * Resolves initial system settings from environment variables with validated production-safe defaults.
 * Each field is validated independently so one invalid environment value never discards other valid overrides.
 */
export function resolveDefaultSystemSettings(
  env: Record<string, string | undefined> = {}
): SystemSettings {
  const demoEnabled = parseOptionalBoolean(env.ENABLE_DEMO_MODE, true);
  const rawEmail = (env.ON_CALL_ENGINEER_EMAIL || env.ONCALL_TO_EMAIL || '').trim();
  const shape = SystemSettingsSchema.shape;

  const candidate: SystemSettings = {
    rejectionCooldownSeconds: resolveSchemaField(
      shape.rejectionCooldownSeconds,
      Math.max(
        0,
        Math.min(
          86_400,
          Math.trunc(
            parseNumber(env.REJECTION_COOLDOWN_SECONDS, DEFAULT_REJECTION_COOLDOWN_SECONDS)
          )
        )
      ),
      DEFAULT_REJECTION_COOLDOWN_SECONDS
    ),
    repeatSuppressionSeconds: resolveSchemaField(
      shape.repeatSuppressionSeconds,
      Math.max(
        0,
        Math.min(
          86_400,
          Math.trunc(
            parseNumber(env.REPEAT_SUPPRESSION_SECONDS, DEFAULT_REPEAT_SUPPRESSION_SECONDS)
          )
        )
      ),
      DEFAULT_REPEAT_SUPPRESSION_SECONDS
    ),
    decisionTtlSeconds: resolveSchemaField(
      shape.decisionTtlSeconds,
      Math.max(
        60,
        Math.min(
          86_400,
          Math.trunc(parseNumber(env.DECISION_TTL_SECONDS, DEFAULT_DECISION_TTL_SECONDS))
        )
      ),
      DEFAULT_DECISION_TTL_SECONDS
    ),
    autoRestoreOnApprove: parseOptionalBoolean(env.AUTO_RESTORE_ON_APPROVE, demoEnabled),
    targetServicePath: resolveSchemaField(
      shape.targetServicePath,
      (env.TARGET_SERVICE_PATH || DEFAULT_SERVICE_PATH).trim(),
      DEFAULT_SERVICE_PATH
    ),
    targetBaseRef: resolveSchemaField(
      shape.targetBaseRef,
      (env.TARGET_BASE_REF || OrchestratorDefault.DEFAULT_BASE_REF).trim(),
      OrchestratorDefault.DEFAULT_BASE_REF
    ),
    targetHeadRef: resolveSchemaField(
      shape.targetHeadRef,
      (env.TARGET_HEAD_REF || OrchestratorDefault.DEFAULT_HEAD_REF).trim(),
      OrchestratorDefault.DEFAULT_HEAD_REF
    ),
    targetErrorRateThresholdPercent: resolveSchemaField(
      shape.targetErrorRateThresholdPercent,
      Math.max(
        0.1,
        Math.min(
          100,
          parseNumber(env.TARGET_ERROR_RATE_THRESHOLD_PERCENT, DEFAULT_ERROR_RATE_THRESHOLD_PERCENT)
        )
      ),
      DEFAULT_ERROR_RATE_THRESHOLD_PERCENT
    ),
    llmModel: resolveSchemaField(
      shape.llmModel,
      (env.LLM_MODEL || DEFAULT_LLM_MODEL).trim(),
      DEFAULT_LLM_MODEL
    ),
    llmFallbackModel: resolveSchemaField(
      shape.llmFallbackModel,
      (env.LLM_FALLBACK_MODEL || DEFAULT_LLM_FALLBACK_MODEL).trim(),
      DEFAULT_LLM_FALLBACK_MODEL
    ),
    onCallEmail: resolveSchemaField(shape.onCallEmail, rawEmail, ''),
    logLevel: resolveLogLevel(env.LOG_LEVEL)
  };

  return SystemSettingsSchema.parse(candidate);
}

/**
 * Masks an email address before persisting into audit logs or unauthenticated read views.
 */
export function maskEmailForDisplay(email: string): string {
  const trimmed = email.trim();
  if (!isNonEmptyString(trimmed)) {
    return '';
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const visiblePrefix = local.slice(0, Math.min(2, local.length));
  return `${visiblePrefix}***${domain}`;
}
