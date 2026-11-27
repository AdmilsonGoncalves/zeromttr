import { GoogleGenAI, Type } from '@google/genai';
import { resolveFirstNonEmpty } from '@zeromttr/utils';
import { CONTENT_TYPE } from '@zeromttr/utils/http';
import { LLM_PROVIDER_DEFAULTS, LlmProvider } from '../domain/llm-provider.js';
import type {
  ReasoningPort,
  CollectedEvidence,
  RcaAndPatchSynthesis
} from '../ports/reasoning.port.js';
import {
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_TEMPERATURE,
  LLM_SYSTEM_INSTRUCTION,
  buildAuditedSynthesisPrompt,
  executeWithRetryAndFallback,
  isUnconfiguredApiKey,
  parseAndValidateSynthesisJson,
  resolveFallbackModelName,
  resolveLlmTimeoutMs,
  type LlmCommonAdapterOptions
} from './llm.prompt.js';

/**
 * Backwards-compatible alias for the shared provider-neutral LLM system instruction.
 */
export const GEMINI_SYSTEM_INSTRUCTION = LLM_SYSTEM_INSTRUCTION;

export type GeminiAdapterOptions = LlmCommonAdapterOptions;

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
  private readonly timeoutMs?: number;
  private readonly getModels?: () => { modelName: string; fallbackModelName: string };

  public constructor(apiKey?: string, modelName?: string, options: GeminiAdapterOptions = {}) {
    const defaults = LLM_PROVIDER_DEFAULTS[LlmProvider.GEMINI];
    this.apiKey =
      apiKey !== undefined
        ? apiKey.trim()
        : resolveFirstNonEmpty(process.env.LLM_API_KEY, process.env.GEMINI_API_KEY);
    this.client = new GoogleGenAI({ apiKey: this.apiKey || 'placeholder-for-instantiation' });
    this.modelName = resolveFirstNonEmpty(modelName, process.env.LLM_MODEL, defaults.primaryModel);
    this.fallbackModelName = resolveFallbackModelName(
      options.fallbackModelName,
      process.env.LLM_FALLBACK_MODEL,
      defaults.fallbackModel
    );
    this.systemInstruction = options.systemInstruction ?? LLM_SYSTEM_INSTRUCTION;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.timeoutMs = options.timeoutMs;
    this.getModels = options.getModels;
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
    const requestPromise = this.client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: this.systemInstruction,
        temperature: DEFAULT_LLM_TEMPERATURE,
        maxOutputTokens: DEFAULT_LLM_MAX_OUTPUT_TOKENS,
        responseMimeType: CONTENT_TYPE.JSON,
        responseSchema: RCA_SYNTHESIS_SCHEMA
      }
    });
    requestPromise.catch(() => undefined);

    try {
      response = await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    return parseAndValidateSynthesisJson(response?.text, 'Gemini');
  }

  /**
   * Calls Gemini with structured output schema and retry/fallback model handling to synthesize RCA and a patch.
   */
  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    if (isUnconfiguredApiKey(this.apiKey)) {
      throw new Error('Gemini API key is not configured');
    }

    const prompt = buildAuditedSynthesisPrompt(evidence);
    const timeoutMs = resolveLlmTimeoutMs(this.timeoutMs);
    const dynamicModels = this.getModels?.();
    const primaryModel = dynamicModels?.modelName || this.modelName;
    const fallbackModel = dynamicModels?.fallbackModelName || this.fallbackModelName;

    return executeWithRetryAndFallback({
      primaryModel,
      fallbackModel,
      maxRetries: this.maxRetries,
      retryDelayMs: this.retryDelayMs,
      invoke: (model) => this.invokeModelWithTimeout(model, prompt, timeoutMs),
      fallbackErrorMessage: 'Gemini synthesis failed'
    });
  }
}
