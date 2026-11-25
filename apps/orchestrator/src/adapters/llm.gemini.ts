import { GoogleGenAI, Type } from '@google/genai';
import { RcaAndPatchSynthesisSchema } from '@zeromttr/contracts';
import { isNonEmptyString, parseNumber, safeJsonParse } from '@zeromttr/utils';
import { ReasoningProvider } from '../domain/incident-enums.js';
import { PiiPromptGuard } from '../domain/pii-prompt-guard.js';
import type {
  ReasoningPort,
  CollectedEvidence,
  RcaAndPatchSynthesis
} from '../ports/reasoning.port.js';

// System prompt instructing Gemini to synthesize full-file fixes and pt-BR RCA summaries
export const GEMINI_SYSTEM_INSTRUCTION = `You are the ZeroMTTR Autonomous SRE Reasoner, a specialist in Root Cause Analysis (RCA) and remediation engineering for production microservices.

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

export interface GeminiAdapterOptions {
  systemInstruction?: string;
  fallbackModelName?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

// Structured Gemini response schema enforcing deterministic RCA and patch JSON fields
export const RCA_SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Executive summary of the incident in 1 paragraph'
    },
    rootCause: {
      type: Type.STRING,
      description: 'Detailed technical explanation of the root cause found in the code'
    },
    evidenceRefs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of evidence references'
    },
    suspectFilePath: {
      type: Type.STRING,
      description: 'Path of the remediated file'
    },
    patchedContent: {
      type: Type.STRING,
      description: 'Complete content of the fixed file ready to commit'
    },
    explanation: {
      type: Type.STRING,
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
  ]
};

/**
 * Gemini reasoning adapter synthesizing structured RCA reports and full-file patches with retry/fallback.
 */
export class GeminiReasoningAdapter implements ReasoningPort {
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly fallbackModelName: string;
  private readonly systemInstruction: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  public constructor(apiKey?: string, modelName?: string, options: GeminiAdapterOptions = {}) {
    this.apiKey = apiKey ?? (process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || '');
    this.client = new GoogleGenAI({ apiKey: this.apiKey || 'placeholder-for-instantiation' });
    this.modelName = modelName || process.env.LLM_MODEL || 'gemini-3.5-flash';
    this.fallbackModelName =
      options.fallbackModelName ?? process.env.LLM_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite';
    this.systemInstruction = options.systemInstruction ?? GEMINI_SYSTEM_INSTRUCTION;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  private async invokeModelWithTimeout(
    model: string,
    prompt: string,
    timeoutMs: number
  ): Promise<RcaAndPatchSynthesis> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Gemini generateContent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    let response;
    try {
      response = await Promise.race([
        this.client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: this.systemInstruction,
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: RCA_SYNTHESIS_SCHEMA
          }
        }),
        timeoutPromise
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    const text = response?.text;
    if (!isNonEmptyString(text)) {
      throw new Error('Empty response from Gemini LLM');
    }

    const rawParsed = safeJsonParse<unknown>(text);
    const validated = RcaAndPatchSynthesisSchema.safeParse(rawParsed);
    if (!validated.success) {
      throw new Error(
        'Failed to parse structured JSON response from Gemini or missing required schema fields'
      );
    }

    return {
      ...validated.data,
      reasoningSource: ReasoningProvider.LLM
    };
  }

  /**
   * Calls Gemini with structured output schema and retry/fallback model handling to synthesize RCA and a patch.
   */
  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    if (!isNonEmptyString(this.apiKey) || this.apiKey === 'change-me-gemini-api-key') {
      throw new Error('Gemini API key is not configured');
    }

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

    const prompt = `Analyze the incident telemetry and deploy diff, then synthesize the RCA and surgical patch:
${suspectFileHeader}Incident Telemetry & Evidence:
${JSON.stringify(sanitizedEvidenceForPrompt, null, 2)}

Strict instructions for patchedContent:
- Return the COMPLETE source code file.
- Keep all original imports, types, classes, methods, and exports intact.
- Apply only the surgical fix for the regression identified in the deploy diff and telemetry, restoring healthy baseline behavior.
- NEVER truncate, omit methods, or return partial placeholder stubs.`;

    const promptAudit = PiiPromptGuard.inspectAndEnforceFailClosed(prompt);
    if (!promptAudit.passed) {
      throw new Error(
        `Fail-closed PII guard blocked Gemini prompt dispatch (${promptAudit.detectedTypes.join(', ')})`
      );
    }

    const timeoutMs = parseNumber(process.env.GEMINI_TIMEOUT_MS, 25_000);

    const modelsToTry = [this.modelName];
    if (isNonEmptyString(this.fallbackModelName) && this.fallbackModelName !== this.modelName) {
      modelsToTry.push(this.fallbackModelName);
    }

    let lastError: unknown;
    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const model = modelsToTry[modelIdx];
      const attempts = modelIdx === 0 ? 1 + Math.max(0, this.maxRetries) : 1;

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return await this.invokeModelWithTimeout(model, prompt, timeoutMs);
        } catch (err) {
          lastError = err;
          if (attempt + 1 < attempts && this.retryDelayMs > 0) {
            const backoffMs = this.retryDelayMs * 2 ** attempt;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Gemini synthesis failed');
  }
}
