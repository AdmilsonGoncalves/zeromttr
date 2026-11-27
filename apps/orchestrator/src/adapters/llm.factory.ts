import { isNonEmptyString, resolveFirstNonEmpty } from '@zeromttr/utils';
import {
  LLM_PROVIDER_DEFAULTS,
  LlmProvider,
  SUPPORTED_LLM_PROVIDERS,
  resolveLlmProvider,
  type OpenAiResponseFormatMode
} from '../domain/llm-provider.js';
import type { ReasoningPort } from '../ports/reasoning.port.js';
import { AnthropicReasoningAdapter } from './llm.anthropic.js';
import { GeminiReasoningAdapter } from './llm.gemini.js';
import { OpenAiCompatibleReasoningAdapter } from './llm.openai-compatible.js';
import {
  resolveFallbackModelName,
  resolveLlmTimeoutMs,
  type LlmCommonAdapterOptions
} from './llm.prompt.js';

export interface CreateReasoningAdapterOptions extends LlmCommonAdapterOptions {
  provider?: string;
  apiKey?: string;
  modelName?: string;
  baseUrl?: string;
  requireApiKey?: boolean;
  responseFormat?: OpenAiResponseFormatMode;
  env?: Record<string, string | undefined>;
}

function resolveConfiguredResponseFormat(
  optionFormat?: OpenAiResponseFormatMode,
  envFormat?: string
): OpenAiResponseFormatMode | undefined {
  if (optionFormat === 'json_schema' || optionFormat === 'json_object') {
    return optionFormat;
  }
  if (!isNonEmptyString(envFormat)) {
    return undefined;
  }
  const normalized = envFormat.trim().toLowerCase();
  if (normalized === 'json_schema' || normalized === 'json_object') {
    return normalized;
  }
  return undefined;
}

/**
 * Factory selecting the configured `ReasoningPort` implementation based on `LLM_PROVIDER`
 * (defaults to `gemini`; supports OpenAI-compatible providers and Anthropic Claude).
 */
export function createReasoningAdapter(options: CreateReasoningAdapterOptions = {}): ReasoningPort {
  const env = options.env ?? process.env;
  const rawProvider = options.provider ?? env.LLM_PROVIDER;
  const provider = resolveLlmProvider(rawProvider);

  if (!provider) {
    throw new Error(
      `Unsupported LLM_PROVIDER '${rawProvider}'. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}`
    );
  }

  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  const modelName = resolveFirstNonEmpty(options.modelName, env.LLM_MODEL, defaults.primaryModel);
  const fallbackModelName = resolveFallbackModelName(
    options.fallbackModelName,
    env.LLM_FALLBACK_MODEL,
    defaults.fallbackModel
  );
  const baseUrl = resolveFirstNonEmpty(options.baseUrl, env.LLM_BASE_URL, defaults.baseUrl);
  const timeoutMs = options.env ? resolveLlmTimeoutMs(options.timeoutMs, env) : options.timeoutMs;

  const commonOptions: LlmCommonAdapterOptions = {
    systemInstruction: options.systemInstruction,
    fallbackModelName,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
    timeoutMs,
    getModels: options.getModels
  };

  if (provider === LlmProvider.GEMINI) {
    const apiKey =
      options.apiKey !== undefined
        ? options.apiKey.trim()
        : resolveFirstNonEmpty(env.LLM_API_KEY, env.GEMINI_API_KEY);
    return new GeminiReasoningAdapter(apiKey, modelName, commonOptions);
  }

  if (provider === LlmProvider.ANTHROPIC) {
    const apiKey =
      options.apiKey !== undefined
        ? options.apiKey.trim()
        : resolveFirstNonEmpty(env.LLM_API_KEY, env.ANTHROPIC_API_KEY);
    return new AnthropicReasoningAdapter(apiKey, modelName, {
      ...commonOptions,
      baseUrl
    });
  }

  const apiKey =
    options.apiKey !== undefined ? options.apiKey.trim() : resolveFirstNonEmpty(env.LLM_API_KEY);
  const responseFormat = resolveConfiguredResponseFormat(
    options.responseFormat,
    env.LLM_RESPONSE_FORMAT
  );
  return new OpenAiCompatibleReasoningAdapter(apiKey, modelName, {
    ...commonOptions,
    providerName: provider,
    baseUrl,
    requireApiKey: options.requireApiKey,
    responseFormat
  });
}
