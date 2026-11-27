import { RcaAndPatchSynthesisSchema } from '@zeromttr/contracts';
import { isNonEmptyString, parseNumber, safeJsonParse } from '@zeromttr/utils';
import { ReasoningProvider } from '../domain/incident-enums.js';
import { PiiPromptGuard } from '../domain/pii-prompt-guard.js';
import type { CollectedEvidence, RcaAndPatchSynthesis } from '../ports/reasoning.port.js';

export const DEFAULT_LLM_TIMEOUT_MS = 25_000;
export const DEFAULT_LLM_TEMPERATURE = 0.1;
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 8192;

// Provider-neutral system prompt instructing the LLM to synthesize full-file fixes and pt-BR RCA summaries
export const LLM_SYSTEM_INSTRUCTION = `You are the ZeroMTTR Autonomous SRE Reasoner, a specialist in Root Cause Analysis (RCA) and remediation engineering for production microservices.

Your mission:
1. Analyze the collected telemetry evidence (Prometheus, Loki, Tempo, Git Diff).
2. Identify the exact root cause of the anomaly, correlating metric degradation with the regression introduced in the code diff.
3. Produce a concise explanation in Brazilian Portuguese (pt-BR) for on-call engineers.
4. Generate the COMPLETE fixed source code file (patchedContent), restoring operational stability.

Strict security and coding rules:
- The fixed code in patchedContent MUST contain the COMPLETE file (never use ellipses or partial snippets).
- Preserve the suspectFilePath identified in the deploy diff and fix the root cause of the regression (such as resource leaks, missing cleanup in finally blocks, or degraded pool/timeout settings), restoring the healthy baseline behavior.
- Never invent dependencies or alter public method signatures.
- You must respond strictly in structured JSON matching the requested schema.`;

// Standard JSON Schema used by OpenAI-compatible json_schema and Anthropic tool input_schema
export const RCA_SYNTHESIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Executive summary of the incident in 1 paragraph'
    },
    rootCause: {
      type: 'string',
      description: 'Detailed technical explanation of the root cause found in the code'
    },
    evidenceRefs: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of evidence references'
    },
    suspectFilePath: {
      type: 'string',
      description: 'Path of the remediated file'
    },
    patchedContent: {
      type: 'string',
      description: 'Complete content of the fixed file ready to commit'
    },
    explanation: {
      type: 'string',
      description: 'Explanation of the change made in the patch and how it resolves the incident'
    }
  },
  required: [
    'summary',
    'rootCause',
    'evidenceRefs',
    'suspectFilePath',
    'patchedContent',
    'explanation'
  ],
  additionalProperties: false
} as const;

export interface LlmCommonAdapterOptions {
  systemInstruction?: string;
  fallbackModelName?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  getModels?: () => { modelName: string; fallbackModelName: string };
}

const PLACEHOLDER_API_KEY_PREFIXES = ['change-me-', 'replace_with_'];

/**
 * Resolves a fallback model name, preserving an explicit option (including `''` to disable fallback),
 * treating blank environment variables as unset, and falling back to the provider default.
 */
export function resolveFallbackModelName(
  optionValue: string | undefined,
  envValue: string | undefined,
  defaultValue: string
): string {
  if (optionValue !== undefined) {
    return optionValue;
  }
  if (isNonEmptyString(envValue)) {
    return envValue.trim();
  }
  return defaultValue;
}

/**
 * Appends the explicit JSON schema contract to the system instruction for providers
 * that enforce `json_object` mode instead of strict `json_schema` structured outputs.
 */
export function buildJsonObjectSystemInstruction(baseInstruction: string): string {
  return `${baseInstruction}

Return a valid JSON object strictly matching this JSON Schema (no additional properties, no markdown fences):
${JSON.stringify(RCA_SYNTHESIS_JSON_SCHEMA)}`;
}

/**
 * Returns true when an API key is blank or still holds a template placeholder prefix.
 */
export function isUnconfiguredApiKey(apiKey: string): boolean {
  if (!isNonEmptyString(apiKey)) {
    return true;
  }
  const normalized = apiKey.trim().toLowerCase();
  return PLACEHOLDER_API_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Resolves the LLM request timeout, prioritizing `LLM_TIMEOUT_MS` with legacy `GEMINI_TIMEOUT_MS` fallback.
 */
export function resolveLlmTimeoutMs(
  overrideTimeoutMs?: number,
  env: Record<string, string | undefined> = process.env,
  defaultMs: number = DEFAULT_LLM_TIMEOUT_MS
): number {
  if (
    typeof overrideTimeoutMs === 'number' &&
    Number.isFinite(overrideTimeoutMs) &&
    overrideTimeoutMs > 0
  ) {
    return overrideTimeoutMs;
  }

  const rawTimeout = isNonEmptyString(env.LLM_TIMEOUT_MS)
    ? env.LLM_TIMEOUT_MS
    : env.GEMINI_TIMEOUT_MS;
  const parsed = parseNumber(rawTimeout, defaultMs);
  return parsed > 0 ? parsed : defaultMs;
}

/**
 * Builds the structured incident evidence prompt shared across all LLM reasoning adapters.
 */
export function buildSynthesisPrompt(evidence: CollectedEvidence): string {
  const suspectFileHeader = isNonEmptyString(evidence.gitDiff?.suspectFileContent)
    ? `Existing source code of '${evidence.gitDiff.suspectFilePath}':\n\`\`\`typescript\n${evidence.gitDiff.suspectFileContent}\n\`\`\`\n\n`
    : '';

  const sanitizedEvidenceForPrompt = {
    ...evidence,
    gitDiff: {
      ...evidence.gitDiff,
      suspectFileContent: undefined
    }
  };

  return `Analyze the incident telemetry and deploy diff, then synthesize the RCA and surgical patch:
${suspectFileHeader}Incident Telemetry & Evidence:
${JSON.stringify(sanitizedEvidenceForPrompt, null, 2)}

Strict instructions for patchedContent:
- Return the COMPLETE source code file.
- Keep all original imports, types, classes, methods, and exports intact.
- Apply only the surgical fix for the regression identified in the deploy diff and telemetry, restoring healthy baseline behavior.
- NEVER truncate, omit methods, or return partial placeholder stubs.`;
}

/**
 * Builds the incident prompt and enforces the fail-closed `PiiPromptGuard` before any LLM dispatch.
 */
export function buildAuditedSynthesisPrompt(evidence: CollectedEvidence): string {
  const prompt = buildSynthesisPrompt(evidence);
  const promptAudit = PiiPromptGuard.inspectAndEnforceFailClosed(prompt);
  if (!promptAudit.passed) {
    throw new Error(
      `Fail-closed PII guard blocked LLM prompt dispatch (${promptAudit.detectedTypes.join(', ')})`
    );
  }
  return prompt;
}

/**
 * Validates a parsed candidate object against the strict 6-field `RcaAndPatchSynthesisSchema`.
 */
export function validateSynthesisObject(
  candidate: unknown,
  providerLabel = 'LLM'
): RcaAndPatchSynthesis {
  const validated = RcaAndPatchSynthesisSchema.safeParse(candidate);
  if (!validated.success) {
    throw new Error(
      `Failed to parse structured JSON response from ${providerLabel} or missing required schema fields`
    );
  }

  return {
    ...validated.data,
    reasoningSource: ReasoningProvider.LLM
  };
}

/**
 * Parses and validates raw JSON text returned by an LLM against `RcaAndPatchSynthesisSchema`.
 */
export function parseAndValidateSynthesisJson(
  text: string | undefined | null,
  providerLabel = 'LLM'
): RcaAndPatchSynthesis {
  if (!isNonEmptyString(text)) {
    throw new Error(`Empty response from ${providerLabel} LLM`);
  }

  const rawParsed = safeJsonParse<unknown>(text);
  return validateSynthesisObject(rawParsed, providerLabel);
}

/**
 * Executes an LLM synthesis call with exponential backoff retries on the primary model
 * and a single fallback attempt on the secondary model when configured.
 */
export async function executeWithRetryAndFallback<T>(params: {
  primaryModel: string;
  fallbackModel?: string;
  maxRetries: number;
  retryDelayMs: number;
  invoke: (model: string) => Promise<T>;
  fallbackErrorMessage?: string;
}): Promise<T> {
  const modelsToTry = [params.primaryModel];
  if (isNonEmptyString(params.fallbackModel) && params.fallbackModel !== params.primaryModel) {
    modelsToTry.push(params.fallbackModel);
  }

  let lastError: unknown;
  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
    const model = modelsToTry[modelIdx];
    const attempts = modelIdx === 0 ? 1 + Math.max(0, params.maxRetries) : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await params.invoke(model);
      } catch (err) {
        lastError = err;
        if (attempt + 1 < attempts && params.retryDelayMs > 0) {
          const backoffMs = params.retryDelayMs * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(params.fallbackErrorMessage ?? 'LLM synthesis failed');
}
