import { isNonEmptyString, isObject, resolveFirstNonEmpty } from '@zeromttr/utils';
import { HTTP_HEADERS, sanitizeHeaderValue } from '@zeromttr/utils/http';
import {
  LLM_PROVIDER_DEFAULTS,
  LlmProvider,
  type OpenAiResponseFormatMode
} from '../domain/llm-provider.js';
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
  buildJsonObjectSystemInstruction,
  executeWithRetryAndFallback,
  isUnconfiguredApiKey,
  parseAndValidateSynthesisJson,
  resolveFallbackModelName,
  resolveLlmTimeoutMs,
  type LlmCommonAdapterOptions
} from './llm.prompt.js';

export type OpenAiCompatibleProvider =
  | LlmProvider.OPENAI
  | LlmProvider.OPENAI_COMPATIBLE
  | LlmProvider.OPENROUTER
  | LlmProvider.GROQ
  | LlmProvider.DEEPSEEK
  | LlmProvider.OLLAMA
  | LlmProvider.VLLM;

export interface OpenAiCompatibleAdapterOptions extends LlmCommonAdapterOptions {
  baseUrl?: string;
  providerName?: OpenAiCompatibleProvider | string;
  requireApiKey?: boolean;
  responseFormat?: OpenAiResponseFormatMode;
  extraHeaders?: Record<string, string>;
}

function extractMessageText(payload: unknown): string {
  if (!isObject(payload) || !Array.isArray(payload.choices)) {
    return '';
  }

  const firstChoice = payload.choices[0];
  if (!isObject(firstChoice) || !isObject(firstChoice.message)) {
    return '';
  }

  const content = firstChoice.message.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    return parts.join('');
  }

  return '';
}

function resolveProviderPreset(providerName: string) {
  const normalized = providerName.trim().toLowerCase() as LlmProvider;
  if (Object.hasOwn(LLM_PROVIDER_DEFAULTS, normalized)) {
    return LLM_PROVIDER_DEFAULTS[normalized];
  }
  return LLM_PROVIDER_DEFAULTS[LlmProvider.OPENAI_COMPATIBLE];
}

/**
 * Reasoning adapter for OpenAI-compatible Chat Completions APIs
 * (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, vLLM, and custom gateways).
 */
export class OpenAiCompatibleReasoningAdapter implements ReasoningPort {
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly fallbackModelName: string;
  private readonly baseUrl: string;
  private readonly providerName: string;
  private readonly requireApiKey: boolean;
  private readonly responseFormat: OpenAiResponseFormatMode;
  private readonly systemInstruction: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs?: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly getModels?: () => { modelName: string; fallbackModelName: string };

  public constructor(
    apiKey?: string,
    modelName?: string,
    options: OpenAiCompatibleAdapterOptions = {}
  ) {
    this.providerName = options.providerName?.trim() || LlmProvider.OPENAI_COMPATIBLE;
    const preset = resolveProviderPreset(this.providerName);

    this.apiKey =
      apiKey !== undefined ? apiKey.trim() : resolveFirstNonEmpty(process.env.LLM_API_KEY);
    this.modelName = resolveFirstNonEmpty(modelName, process.env.LLM_MODEL, preset.primaryModel);
    this.fallbackModelName = resolveFallbackModelName(
      options.fallbackModelName,
      process.env.LLM_FALLBACK_MODEL,
      preset.fallbackModel
    );
    this.baseUrl = resolveFirstNonEmpty(
      options.baseUrl,
      process.env.LLM_BASE_URL,
      preset.baseUrl,
      'https://api.openai.com/v1'
    );
    this.requireApiKey = options.requireApiKey ?? preset.requireApiKey;
    this.responseFormat = options.responseFormat ?? preset.responseFormat ?? 'json_schema';
    this.systemInstruction = options.systemInstruction ?? LLM_SYSTEM_INSTRUCTION;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.timeoutMs = options.timeoutMs;
    this.extraHeaders = options.extraHeaders ?? {};
    this.getModels = options.getModels;
  }

  private async invokeModelWithTimeout(
    endpoint: string,
    model: string,
    prompt: string,
    timeoutMs: number
  ): Promise<RcaAndPatchSynthesis> {
    const headers: Record<string, string> = {};

    for (const [headerKey, headerValue] of Object.entries(this.extraHeaders)) {
      if (isNonEmptyString(headerKey) && isNonEmptyString(headerValue)) {
        headers[sanitizeHeaderValue(headerKey)] = sanitizeHeaderValue(headerValue);
      }
    }

    if (!isUnconfiguredApiKey(this.apiKey)) {
      headers[HTTP_HEADERS.AUTHORIZATION] = `Bearer ${sanitizeHeaderValue(this.apiKey)}`;
    }

    const useJsonObject = this.responseFormat === 'json_object';
    const systemPrompt = useJsonObject
      ? buildJsonObjectSystemInstruction(this.systemInstruction)
      : this.systemInstruction;
    const responseFormatPayload = useJsonObject
      ? { type: 'json_object' }
      : {
          type: 'json_schema',
          json_schema: {
            name: 'rca_and_patch_synthesis',
            strict: true,
            schema: RCA_SYNTHESIS_JSON_SCHEMA
          }
        };

    const parsedBody = await postJsonWithTimeout({
      endpoint,
      headers,
      body: {
        model,
        temperature: DEFAULT_LLM_TEMPERATURE,
        max_tokens: DEFAULT_LLM_MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: responseFormatPayload
      },
      timeoutMs,
      providerLabel: this.providerName
    });

    const messageText = extractMessageText(parsedBody);
    return parseAndValidateSynthesisJson(messageText, this.providerName);
  }

  /**
   * Calls an OpenAI-compatible `/chat/completions` endpoint with structured JSON output,
   * fail-closed PII guard, timeout enforcement, retry, and fallback model handling.
   */
  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    if (this.requireApiKey && isUnconfiguredApiKey(this.apiKey)) {
      throw new Error(`LLM API key is not configured for provider '${this.providerName}'`);
    }

    const endpoint = resolveProviderEndpoint(this.baseUrl, '/chat/completions');
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
      fallbackErrorMessage: `LLM synthesis failed for provider '${this.providerName}'`
    });
  }
}
