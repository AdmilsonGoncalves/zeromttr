import { isObject, resolveFirstNonEmpty } from '@zeromttr/utils';
import { sanitizeHeaderValue } from '@zeromttr/utils/http';
import { LLM_PROVIDER_DEFAULTS, LlmProvider } from '../domain/llm-provider.js';
import type {
  CollectedEvidence,
  RcaAndPatchSynthesis,
  ReasoningPort
} from '../ports/reasoning.port.js';
import { postJsonWithTimeout, resolveProviderEndpoint } from './llm.http.js';
import {
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_TEMPERATURE,
  LLM_SYSTEM_INSTRUCTION,
  RCA_SYNTHESIS_JSON_SCHEMA,
  buildAuditedSynthesisPrompt,
  executeWithRetryAndFallback,
  isUnconfiguredApiKey,
  parseAndValidateSynthesisJson,
  resolveFallbackModelName,
  resolveLlmTimeoutMs,
  validateSynthesisObject,
  type LlmCommonAdapterOptions
} from './llm.prompt.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_SYNTHESIS_TOOL_NAME = 'submit_rca_and_patch';

export interface AnthropicAdapterOptions extends LlmCommonAdapterOptions {
  baseUrl?: string;
  anthropicVersion?: string;
}

function parseAnthropicResponse(payload: unknown): RcaAndPatchSynthesis {
  if (!isObject(payload) || !Array.isArray(payload.content)) {
    throw new Error('Empty response from Anthropic LLM');
  }

  for (const block of payload.content) {
    if (
      isObject(block) &&
      block.type === 'tool_use' &&
      block.name === ANTHROPIC_SYNTHESIS_TOOL_NAME
    ) {
      return validateSynthesisObject(block.input, 'Anthropic');
    }
  }

  const textParts: string[] = [];
  for (const block of payload.content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }

  return parseAndValidateSynthesisJson(textParts.join(''), 'Anthropic');
}

/**
 * Dedicated Anthropic Claude reasoning adapter calling the Messages API (`POST /v1/messages`)
 * with forced JSON-schema tool output, fail-closed PII guard, retry, and fallback model support.
 */
export class AnthropicReasoningAdapter implements ReasoningPort {
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly fallbackModelName: string;
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;
  private readonly systemInstruction: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs?: number;
  private readonly getModels?: () => { modelName: string; fallbackModelName: string };

  public constructor(apiKey?: string, modelName?: string, options: AnthropicAdapterOptions = {}) {
    const defaults = LLM_PROVIDER_DEFAULTS[LlmProvider.ANTHROPIC];
    this.apiKey =
      apiKey !== undefined
        ? apiKey.trim()
        : resolveFirstNonEmpty(process.env.LLM_API_KEY, process.env.ANTHROPIC_API_KEY);
    this.modelName = resolveFirstNonEmpty(modelName, process.env.LLM_MODEL, defaults.primaryModel);
    this.fallbackModelName = resolveFallbackModelName(
      options.fallbackModelName,
      process.env.LLM_FALLBACK_MODEL,
      defaults.fallbackModel
    );
    this.baseUrl = resolveFirstNonEmpty(
      options.baseUrl,
      process.env.LLM_BASE_URL,
      defaults.baseUrl,
      'https://api.anthropic.com/v1'
    );
    this.anthropicVersion = options.anthropicVersion || ANTHROPIC_API_VERSION;
    this.systemInstruction = options.systemInstruction ?? LLM_SYSTEM_INSTRUCTION;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.timeoutMs = options.timeoutMs;
    this.getModels = options.getModels;
  }

  private async invokeModelWithTimeout(
    endpoint: string,
    model: string,
    prompt: string,
    timeoutMs: number
  ): Promise<RcaAndPatchSynthesis> {
    const parsedBody = await postJsonWithTimeout({
      endpoint,
      headers: {
        'x-api-key': sanitizeHeaderValue(this.apiKey),
        'anthropic-version': sanitizeHeaderValue(this.anthropicVersion)
      },
      body: {
        model,
        max_tokens: DEFAULT_LLM_MAX_OUTPUT_TOKENS,
        temperature: DEFAULT_LLM_TEMPERATURE,
        system: this.systemInstruction,
        messages: [{ role: 'user', content: prompt }],
        tools: [
          {
            name: ANTHROPIC_SYNTHESIS_TOOL_NAME,
            description:
              'Submit the structured Root Cause Analysis and complete remediated source code file.',
            input_schema: RCA_SYNTHESIS_JSON_SCHEMA
          }
        ],
        tool_choice: {
          type: 'tool',
          name: ANTHROPIC_SYNTHESIS_TOOL_NAME
        }
      },
      timeoutMs,
      providerLabel: LlmProvider.ANTHROPIC
    });

    return parseAnthropicResponse(parsedBody);
  }

  /**
   * Calls Anthropic Messages API with strict schema enforcement, fail-closed PII guard,
   * timeout handling, retries, and fallback model execution.
   */
  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    if (isUnconfiguredApiKey(this.apiKey)) {
      throw new Error('Anthropic API key is not configured');
    }

    const endpoint = resolveProviderEndpoint(this.baseUrl, '/messages');
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
      invoke: (model) => this.invokeModelWithTimeout(endpoint, model, prompt, timeoutMs),
      fallbackErrorMessage: 'Anthropic synthesis failed'
    });
  }
}
