import { isNonEmptyString } from '@zeromttr/utils';

export enum LlmProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
  OPENAI_COMPATIBLE = 'openai-compatible',
  OPENROUTER = 'openrouter',
  GROQ = 'groq',
  DEEPSEEK = 'deepseek',
  OLLAMA = 'ollama',
  VLLM = 'vllm',
  ANTHROPIC = 'anthropic'
}

export type OpenAiResponseFormatMode = 'json_schema' | 'json_object';

export const SUPPORTED_LLM_PROVIDERS: readonly LlmProvider[] = Object.values(LlmProvider);

export interface LlmProviderDefaults {
  primaryModel: string;
  fallbackModel: string;
  baseUrl?: string;
  requireApiKey: boolean;
  responseFormat?: OpenAiResponseFormatMode;
}

export const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, LlmProviderDefaults> = {
  [LlmProvider.GEMINI]: {
    primaryModel: 'gemini-3.5-flash',
    fallbackModel: 'gemini-3.5-flash-lite',
    requireApiKey: true
  },
  [LlmProvider.OPENAI]: {
    primaryModel: 'gpt-4o-mini',
    fallbackModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    requireApiKey: true,
    responseFormat: 'json_schema'
  },
  [LlmProvider.OPENAI_COMPATIBLE]: {
    primaryModel: 'gpt-4o-mini',
    fallbackModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    requireApiKey: true,
    responseFormat: 'json_schema'
  },
  [LlmProvider.OPENROUTER]: {
    primaryModel: 'openai/gpt-4o-mini',
    fallbackModel: 'openai/gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
    requireApiKey: true,
    responseFormat: 'json_schema'
  },
  [LlmProvider.GROQ]: {
    primaryModel: 'llama-3.3-70b-versatile',
    fallbackModel: 'llama-3.1-8b-instant',
    baseUrl: 'https://api.groq.com/openai/v1',
    requireApiKey: true,
    responseFormat: 'json_object'
  },
  [LlmProvider.DEEPSEEK]: {
    primaryModel: 'deepseek-chat',
    fallbackModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    requireApiKey: true,
    responseFormat: 'json_object'
  },
  [LlmProvider.OLLAMA]: {
    primaryModel: 'qwen2.5-coder:7b',
    fallbackModel: 'qwen2.5-coder:7b',
    baseUrl: 'http://localhost:11434/v1',
    requireApiKey: false,
    responseFormat: 'json_schema'
  },
  [LlmProvider.VLLM]: {
    primaryModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    fallbackModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    baseUrl: 'http://localhost:8000/v1',
    requireApiKey: false,
    responseFormat: 'json_schema'
  },
  [LlmProvider.ANTHROPIC]: {
    primaryModel: 'claude-sonnet-5-5',
    fallbackModel: 'claude-haiku-5-5',
    baseUrl: 'https://api.anthropic.com/v1',
    requireApiKey: true
  }
};

const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  claude: LlmProvider.ANTHROPIC
};

/**
 * Resolves a raw `LLM_PROVIDER` string to a canonical `LlmProvider` enum value,
 * defaulting to `LlmProvider.GEMINI` when omitted/blank, or returning `null` if unsupported.
 */
export function resolveLlmProvider(raw?: string): LlmProvider | null {
  if (!isNonEmptyString(raw)) {
    return LlmProvider.GEMINI;
  }

  const normalized = raw.trim().toLowerCase();
  if (Object.hasOwn(PROVIDER_ALIASES, normalized)) {
    return PROVIDER_ALIASES[normalized];
  }

  for (const provider of SUPPORTED_LLM_PROVIDERS) {
    if (provider === normalized) {
      return provider;
    }
  }

  return null;
}

/**
 * Resolves default primary and fallback LLM models for the configured provider.
 */
export function resolveDefaultLlmModels(rawProvider?: string): {
  primaryModel: string;
  fallbackModel: string;
} {
  const provider = resolveLlmProvider(rawProvider) ?? LlmProvider.GEMINI;
  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  return {
    primaryModel: defaults.primaryModel,
    fallbackModel: defaults.fallbackModel
  };
}
