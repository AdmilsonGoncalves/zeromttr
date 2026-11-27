import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFirstNonEmpty } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { AnthropicReasoningAdapter } from '../../../src/adapters/llm.anthropic.js';
import { createReasoningAdapter } from '../../../src/adapters/llm.factory.js';
import {
  GEMINI_SYSTEM_INSTRUCTION,
  GeminiReasoningAdapter
} from '../../../src/adapters/llm.gemini.js';
import { resolveProviderEndpoint } from '../../../src/adapters/llm.http.js';
import { OpenAiCompatibleReasoningAdapter } from '../../../src/adapters/llm.openai-compatible.js';
import {
  LLM_SYSTEM_INSTRUCTION,
  RCA_SYNTHESIS_JSON_SCHEMA,
  buildAuditedSynthesisPrompt,
  resolveFallbackModelName,
  resolveLlmTimeoutMs
} from '../../../src/adapters/llm.prompt.js';
import {
  LlmProvider,
  resolveDefaultLlmModels,
  resolveLlmProvider
} from '../../../src/domain/llm-provider.js';
import { resolveDefaultSystemSettings } from '../../../src/domain/system-settings.js';
import { createReasoningAdapter as createReasoningAdapterFromMain } from '../../../src/main.js';
import type { CollectedEvidence } from '../../../src/ports/reasoning.port.js';

const sampleEvidence: CollectedEvidence = {
  incidentId: 'inc-multi-llm-001',
  service: 'orders-api',
  alertName: 'HighErrorRate',
  promqlSummary: {
    metric: 'http_server_duration_milliseconds_bucket',
    p95LatencyMs: 3400
  },
  traceAnalysis: {
    traceId: 'trace-multi-llm-123',
    criticalOperation: 'db.pool.acquire',
    durationMs: 3150,
    servicesInvolved: ['orders-api', 'postgres']
  },
  logSample: 'ERROR connection pool exhausted',
  gitDiff: {
    baseRef: 'v1.0.0',
    headRef: 'v1.0.1',
    suspectCommit: 'sha-999',
    authorLogin: 'dev',
    suspectFilePath: 'src/db.ts',
    patch: '- max: 10\n+ max: 1',
    suspectFileContent: 'export const pool = { max: 1 };\n'
  }
};

const validSynthesisPayload = {
  summary: 'Pool de conexões saturado após redução para max=1.',
  rootCause: 'A release reduziu o limite do pool de 10 para 1.',
  evidenceRefs: ['trace-multi-llm-123', 'sha-999'],
  suspectFilePath: 'src/db.ts',
  patchedContent: 'export const pool = { max: 10 };\n',
  explanation: 'Restaura o limite do pool para 10 conexões.'
};

describe('Multi-LLM Reasoning Adapters & Factory', () => {
  const envKeys = [
    'LLM_PROVIDER',
    'LLM_API_KEY',
    'LLM_MODEL',
    'LLM_FALLBACK_MODEL',
    'LLM_BASE_URL',
    'LLM_RESPONSE_FORMAT',
    'LLM_TIMEOUT_MS',
    'GEMINI_API_KEY',
    'GEMINI_TIMEOUT_MS',
    'ANTHROPIC_API_KEY'
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    nock.disableNetConnect();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    nock.cleanAll();
    nock.enableNetConnect();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('Shared prompt module & timeout resolution', () => {
    it('should_export_neutral_LLM_SYSTEM_INSTRUCTION_with_GEMINI_SYSTEM_INSTRUCTION_alias', () => {
      expect(GEMINI_SYSTEM_INSTRUCTION).toBe(LLM_SYSTEM_INSTRUCTION);
      expect(RCA_SYNTHESIS_JSON_SCHEMA.required).toEqual([
        'summary',
        'rootCause',
        'evidenceRefs',
        'suspectFilePath',
        'patchedContent',
        'explanation'
      ]);
      expect(RCA_SYNTHESIS_JSON_SCHEMA.additionalProperties).toBe(false);
    });

    it('should_prioritize_LLM_TIMEOUT_MS_and_fallback_to_legacy_GEMINI_TIMEOUT_MS', () => {
      expect(resolveLlmTimeoutMs(undefined, {})).toBe(25_000);
      expect(resolveLlmTimeoutMs(undefined, { GEMINI_TIMEOUT_MS: '12000' })).toBe(12_000);
      expect(
        resolveLlmTimeoutMs(undefined, { LLM_TIMEOUT_MS: '8500', GEMINI_TIMEOUT_MS: '12000' })
      ).toBe(8_500);
      expect(resolveLlmTimeoutMs(5_000, { LLM_TIMEOUT_MS: '8500' })).toBe(5_000);
      expect(resolveFirstNonEmpty('   ', undefined, '  key-123  ', 'fallback')).toBe('key-123');
    });

    it('should_block_prompt_dispatch_fail_closed_when_residual_PII_is_present', () => {
      const leakyEvidence: CollectedEvidence = {
        ...sampleEvidence,
        logSample: 'ERROR user email leaked: engineer.real@company.com'
      };
      expect(() => buildAuditedSynthesisPrompt(leakyEvidence)).toThrow(
        /Fail-closed PII guard blocked LLM prompt dispatch/
      );
    });
  });

  describe('OpenAiCompatibleReasoningAdapter', () => {
    it('should_call_POST_chat_completions_with_json_schema_and_return_validated_synthesis', async () => {
      const scope = nock('https://api.openai.com')
        .post('/v1/chat/completions', (body: Record<string, unknown>) => {
          expect(body.model).toBe('gpt-4o-mini');
          expect(body.temperature).toBe(0.1);
          expect(body.max_tokens).toBe(8192);
          const responseFormat = body.response_format as {
            type?: string;
            json_schema?: { name?: string; strict?: boolean; schema?: unknown };
          };
          expect(responseFormat?.type).toBe('json_schema');
          expect(responseFormat?.json_schema?.name).toBe('rca_and_patch_synthesis');
          expect(responseFormat?.json_schema?.strict).toBe(true);
          expect(responseFormat?.json_schema?.schema).toEqual(RCA_SYNTHESIS_JSON_SCHEMA);
          return true;
        })
        .matchHeader('authorization', 'Bearer sk-openai-test')
        .reply(HTTP_STATUS.OK, {
          choices: [
            {
              message: {
                content: JSON.stringify(validSynthesisPayload)
              }
            }
          ]
        });

      const adapter = new OpenAiCompatibleReasoningAdapter('sk-openai-test', 'gpt-4o-mini', {
        providerName: LlmProvider.OPENAI,
        maxRetries: 0,
        retryDelayMs: 0
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);

      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('llm');
      expect(result.suspectFilePath).toBe('src/db.ts');
      expect(result.patchedContent).toBe('export const pool = { max: 10 };\n');
    });

    it('should_support_custom_LLM_BASE_URL_and_array_text_content_parts', async () => {
      const scope = nock('https://openrouter.ai')
        .post('/api/v1/chat/completions')
        .matchHeader('authorization', 'Bearer sk-or-test')
        .reply(HTTP_STATUS.OK, {
          choices: [
            {
              message: {
                content: [{ type: 'text', text: JSON.stringify(validSynthesisPayload) }]
              }
            }
          ]
        });

      const adapter = new OpenAiCompatibleReasoningAdapter('sk-or-test', 'openai/gpt-4o-mini', {
        providerName: LlmProvider.OPENROUTER,
        baseUrl: 'https://openrouter.ai/api/v1',
        maxRetries: 0,
        retryDelayMs: 0
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('llm');
    });

    it('should_allow_local_ollama_without_api_key_and_omit_authorization_header', async () => {
      const scope = nock('http://localhost:11434', {
        badheaders: ['authorization']
      })
        .post('/v1/chat/completions')
        .reply(HTTP_STATUS.OK, {
          choices: [
            {
              message: {
                content: JSON.stringify(validSynthesisPayload)
              }
            }
          ]
        });

      const adapter = new OpenAiCompatibleReasoningAdapter('', 'qwen2.5-coder:7b', {
        providerName: LlmProvider.OLLAMA,
        maxRetries: 0,
        retryDelayMs: 0
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('llm');
    });

    it('should_reject_unconfigured_api_key_for_cloud_providers_before_network_call', async () => {
      const adapter = new OpenAiCompatibleReasoningAdapter(
        'replace_with_your_llm_api_key',
        'gpt-4o-mini',
        {
          providerName: LlmProvider.OPENAI
        }
      );

      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        "LLM API key is not configured for provider 'openai'"
      );
    });

    it('should_block_PII_fail_closed_before_issuing_any_HTTP_request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const adapter = new OpenAiCompatibleReasoningAdapter('sk-openai-test', 'gpt-4o-mini', {
        providerName: LlmProvider.OPENAI
      });

      await expect(
        adapter.synthesizeRcaAndPatch({
          ...sampleEvidence,
          logSample: 'Leaked email: leaked-sre@company.org'
        })
      ).rejects.toThrow(/Fail-closed PII guard blocked LLM prompt dispatch/);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should_use_json_object_for_Groq_retry_primary_and_fallback_using_dynamic_settings', async () => {
      const seenModels: string[] = [];
      const checkGroqBody = (body: Record<string, unknown>) => {
        expect(body.response_format).toEqual({ type: 'json_object' });
        seenModels.push(String(body.model));
        return true;
      };
      const scope = nock('https://api.groq.com')
        .post('/openai/v1/chat/completions', checkGroqBody)
        .reply(HTTP_STATUS.TOO_MANY_REQUESTS, { error: 'rate limited' })
        .post('/openai/v1/chat/completions', checkGroqBody)
        .reply(HTTP_STATUS.SERVICE_UNAVAILABLE, { error: 'upstream overloaded' })
        .post('/openai/v1/chat/completions', checkGroqBody)
        .reply(HTTP_STATUS.OK, {
          choices: [{ message: { content: JSON.stringify(validSynthesisPayload) } }]
        });

      const adapter = new OpenAiCompatibleReasoningAdapter('gsk-test-key', 'ignored-default', {
        providerName: LlmProvider.GROQ,
        maxRetries: 1,
        retryDelayMs: 1,
        getModels: () => ({
          modelName: 'llama-3.3-70b-versatile',
          fallbackModelName: 'llama-3.1-8b-instant'
        })
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(seenModels).toEqual([
        'llama-3.3-70b-versatile',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant'
      ]);
      expect(result.reasoningSource).toBe('llm');
    });

    it('should_reject_malformed_json_and_extra_fields_strictly_with_DeepSeek_json_object', async () => {
      nock('https://api.deepseek.com')
        .post('/v1/chat/completions', (body: Record<string, unknown>) => {
          expect(body.response_format).toEqual({ type: 'json_object' });
          const messages = body.messages as Array<{ role?: string; content?: string }>;
          expect(messages[0]?.role).toBe('system');
          expect(messages[0]?.content).toContain('"patchedContent"');
          return true;
        })
        .reply(HTTP_STATUS.OK, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validSynthesisPayload,
                  unexpectedField: 'hallucination'
                })
              }
            }
          ]
        });

      const adapter = new OpenAiCompatibleReasoningAdapter('sk-ds-test', 'deepseek-chat', {
        providerName: LlmProvider.DEEPSEEK,
        maxRetries: 0,
        retryDelayMs: 0,
        fallbackModelName: ''
      });

      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        /Failed to parse structured JSON response from deepseek/
      );
    });

    it('should_handle_empty_http_200_body_without_double_reading_response_stream', async () => {
      nock('https://api.openai.com').post('/v1/chat/completions').reply(HTTP_STATUS.OK, '');

      const adapter = new OpenAiCompatibleReasoningAdapter('sk-openai-test', 'gpt-4o-mini', {
        providerName: LlmProvider.OPENAI,
        maxRetries: 0,
        retryDelayMs: 0,
        fallbackModelName: ''
      });

      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        'Empty response from openai LLM'
      );
    });

    it('should_preserve_query_strings_and_avoid_duplicating_endpoint_suffix_paths', () => {
      expect(
        resolveProviderEndpoint(
          'https://gw.example.com/v1/chat/completions?api-version=2024-06-01',
          '/chat/completions'
        )
      ).toBe('https://gw.example.com/v1/chat/completions?api-version=2024-06-01');
      expect(
        resolveProviderEndpoint(
          'https://gw.example.com/v1?api-version=2024-06-01',
          '/chat/completions'
        )
      ).toBe('https://gw.example.com/v1/chat/completions?api-version=2024-06-01');
      expect(
        resolveProviderEndpoint('https://gw.example.com/v1/messages/?route=claude', '/messages')
      ).toBe('https://gw.example.com/v1/messages?route=claude');

      for (const badUrl of ['javascript:alert(1)', 'ftp://internal/v1', 'not-a-url']) {
        expect(() => resolveProviderEndpoint(badUrl, '/chat/completions')).toThrow(
          /Invalid LLM_BASE_URL/
        );
      }
    });

    it('should_abort_and_fail_fast_when_response_body_stalls_past_LLM_TIMEOUT_MS', async () => {
      process.env.LLM_TIMEOUT_MS = '30';
      let capturedSignal: AbortSignal | undefined;
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        // Return HTTP 200 headers immediately, then stall forever while streaming body
        return {
          status: HTTP_STATUS.OK,
          ok: true,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            })
        } as unknown as Response;
      });
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new OpenAiCompatibleReasoningAdapter('sk-openai-test', 'gpt-4o-mini', {
        providerName: LlmProvider.OPENAI,
        maxRetries: 0,
        retryDelayMs: 0,
        fallbackModelName: ''
      });

      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        'LLM request (openai) timed out after 30ms'
      );
      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  describe('AnthropicReasoningAdapter', () => {
    it('should_call_POST_v1_messages_with_tool_choice_and_validate_tool_use_input', async () => {
      const scope = nock('https://api.anthropic.com')
        .post('/v1/messages', (body: Record<string, unknown>) => {
          expect(body.model).toBe('claude-sonnet-5-5');
          expect(body.system).toBe(LLM_SYSTEM_INSTRUCTION);
          expect(body.tool_choice).toEqual({
            type: 'tool',
            name: 'submit_rca_and_patch'
          });
          return true;
        })
        .matchHeader('x-api-key', 'sk-ant-test')
        .matchHeader('anthropic-version', '2023-06-01')
        .reply(HTTP_STATUS.OK, {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'submit_rca_and_patch',
              input: validSynthesisPayload
            }
          ]
        });

      const adapter = new AnthropicReasoningAdapter('sk-ant-test', 'claude-sonnet-5-5', {
        maxRetries: 0,
        retryDelayMs: 0
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('llm');
      expect(result.summary).toBe(validSynthesisPayload.summary);
    });

    it('should_parse_text_json_fallback_and_reject_unconfigured_key', async () => {
      const unconfigured = new AnthropicReasoningAdapter('');
      await expect(unconfigured.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        'Anthropic API key is not configured'
      );

      const scope = nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(HTTP_STATUS.OK, {
          content: [{ type: 'text', text: JSON.stringify(validSynthesisPayload) }]
        });

      const adapter = new AnthropicReasoningAdapter('sk-ant-test', 'claude-sonnet-5-5', {
        maxRetries: 0,
        retryDelayMs: 0
      });
      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(result.reasoningSource).toBe('llm');
    });

    it('should_abort_and_fail_fast_when_anthropic_body_stalls_past_LLM_TIMEOUT_MS', async () => {
      process.env.LLM_TIMEOUT_MS = '25';
      let capturedSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          capturedSignal = init?.signal ?? undefined;
          return {
            status: HTTP_STATUS.OK,
            ok: true,
            text: () =>
              new Promise<string>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                  reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
              })
          } as unknown as Response;
        })
      );

      const adapter = new AnthropicReasoningAdapter('sk-ant-test', 'claude-sonnet-5-5', {
        maxRetries: 0,
        retryDelayMs: 0,
        fallbackModelName: ''
      });

      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        'LLM request (anthropic) timed out after 25ms'
      );
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('should_block_PII_fail_closed_and_retry_with_fallback_model_on_anthropic', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const guardAdapter = new AnthropicReasoningAdapter('sk-ant-test', 'claude-sonnet-5-5');
      await expect(
        guardAdapter.synthesizeRcaAndPatch({
          ...sampleEvidence,
          logSample: 'Leaked PII email: oncall@private.example.org'
        })
      ).rejects.toThrow(/Fail-closed PII guard blocked LLM prompt dispatch/);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();

      const seenModels: string[] = [];
      process.env.LLM_FALLBACK_MODEL = '';
      const retryScope = nock('https://api.anthropic.com')
        .post('/v1/messages', (body: { model?: string }) => {
          seenModels.push(String(body.model));
          return true;
        })
        .reply(HTTP_STATUS.TOO_MANY_REQUESTS, { error: 'rate limit' })
        .post('/v1/messages', (body: { model?: string }) => {
          seenModels.push(String(body.model));
          return true;
        })
        .reply(HTTP_STATUS.SERVICE_UNAVAILABLE, { error: 'overloaded' })
        .post('/v1/messages', (body: { model?: string }) => {
          seenModels.push(String(body.model));
          return true;
        })
        .reply(HTTP_STATUS.OK, {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'submit_rca_and_patch',
              input: validSynthesisPayload
            }
          ]
        });

      const retryAdapter = new AnthropicReasoningAdapter('sk-ant-test', 'claude-sonnet-5-5', {
        maxRetries: 1,
        retryDelayMs: 1
      });

      const result = await retryAdapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(retryScope.isDone()).toBe(true);
      expect(seenModels).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
      expect(result.reasoningSource).toBe('llm');
    });
  });

  describe('createReasoningAdapter factory & provider-aware defaults', () => {
    it('should_default_to_GeminiReasoningAdapter_when_LLM_PROVIDER_is_unset_or_gemini', () => {
      expect(createReasoningAdapterFromMain).toBe(createReasoningAdapter);
      expect(createReasoningAdapter({ env: {} })).toBeInstanceOf(GeminiReasoningAdapter);
      expect(createReasoningAdapter({ env: { LLM_PROVIDER: 'gemini' } })).toBeInstanceOf(
        GeminiReasoningAdapter
      );
      expect(createReasoningAdapter({ env: { LLM_PROVIDER: '  GEMINI  ' } })).toBeInstanceOf(
        GeminiReasoningAdapter
      );
    });

    it.each([
      LlmProvider.OPENAI,
      LlmProvider.OPENAI_COMPATIBLE,
      LlmProvider.OPENROUTER,
      LlmProvider.GROQ,
      LlmProvider.DEEPSEEK,
      LlmProvider.OLLAMA,
      LlmProvider.VLLM
    ])('should_instantiate_OpenAiCompatibleReasoningAdapter_for_%s', (provider) => {
      const adapter = createReasoningAdapter({ env: { LLM_PROVIDER: provider } });
      expect(adapter).toBeInstanceOf(OpenAiCompatibleReasoningAdapter);
    });

    it.each(['anthropic', 'claude'])(
      'should_instantiate_AnthropicReasoningAdapter_for_%s',
      (provider) => {
        const adapter = createReasoningAdapter({ env: { LLM_PROVIDER: provider } });
        expect(adapter).toBeInstanceOf(AnthropicReasoningAdapter);
      }
    );

    it.each(['unknown-vendor', 'constructor', '__proto__', 'toString'])(
      'should_throw_clear_error_for_unsupported_or_prototype_LLM_PROVIDER_%s',
      (invalidProvider) => {
        expect(resolveLlmProvider(invalidProvider)).toBeNull();
        expect(resolveDefaultLlmModels(invalidProvider)).toEqual({
          primaryModel: 'gemini-3.5-flash',
          fallbackModel: 'gemini-3.5-flash-lite'
        });
        expect(() => createReasoningAdapter({ env: { LLM_PROVIDER: invalidProvider } })).toThrow(
          /Unsupported LLM_PROVIDER/
        );
      }
    );

    it('should_not_collide_with_Object_prototype_in_OpenAiCompatibleReasoningAdapter_provider_lookup', async () => {
      const adapter = new OpenAiCompatibleReasoningAdapter('', undefined, {
        providerName: 'constructor'
      });
      await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
        "LLM API key is not configured for provider 'constructor'"
      );
    });

    it('should_keep_provider_defaults_with_empty_compose_vars_and_isolate_options_env', async () => {
      expect(resolveFallbackModelName(undefined, '', 'default-lite')).toBe('default-lite');
      expect(resolveFallbackModelName('', 'env-model', 'default-lite')).toBe('');
      expect(resolveFallbackModelName(undefined, '  custom-lite  ', 'default-lite')).toBe(
        'custom-lite'
      );

      // Contaminate process.env to prove options.env (and non-positive options.timeoutMs) stay isolated
      process.env.LLM_MODEL = 'leaked-process-model';
      process.env.LLM_FALLBACK_MODEL = 'leaked-process-fallback';
      process.env.LLM_BASE_URL = 'https://leaked.example.com/v1';
      process.env.LLM_TIMEOUT_MS = '1';

      const seenModels: string[] = [];
      const scope = nock('https://api.groq.com')
        .post('/openai/v1/chat/completions', (body: { model?: string }) => {
          seenModels.push(String(body.model));
          return true;
        })
        .reply(HTTP_STATUS.SERVICE_UNAVAILABLE, 'busy')
        .post('/openai/v1/chat/completions', (body: { model?: string }) => {
          seenModels.push(String(body.model));
          return true;
        })
        .reply(HTTP_STATUS.OK, {
          choices: [{ message: { content: JSON.stringify(validSynthesisPayload) } }]
        });

      const adapter = createReasoningAdapter({
        maxRetries: 0,
        retryDelayMs: 0,
        timeoutMs: 0,
        env: {
          LLM_PROVIDER: 'groq',
          LLM_API_KEY: '  gsk-isolated-key  ',
          LLM_MODEL: '',
          LLM_FALLBACK_MODEL: '',
          LLM_BASE_URL: ''
        }
      });

      const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(scope.isDone()).toBe(true);
      expect(seenModels).toEqual(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
      expect(result.reasoningSource).toBe('llm');
    });

    it('should_isolate_provider_specific_legacy_keys_when_both_GEMINI_and_ANTHROPIC_keys_are_set', async () => {
      const sharedLegacyEnv = {
        LLM_API_KEY: '   ',
        GEMINI_API_KEY: 'gm-legacy-secret',
        ANTHROPIC_API_KEY: 'sk-ant-legacy-secret'
      };

      const anthropicScope = nock('https://api.anthropic.com')
        .post('/v1/messages')
        .matchHeader('x-api-key', 'sk-ant-legacy-secret')
        .reply(HTTP_STATUS.OK, {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_legacy',
              name: 'submit_rca_and_patch',
              input: validSynthesisPayload
            }
          ]
        });

      const anthropicAdapter = createReasoningAdapter({
        maxRetries: 0,
        retryDelayMs: 0,
        env: { ...sharedLegacyEnv, LLM_PROVIDER: 'anthropic' }
      });
      await anthropicAdapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(anthropicScope.isDone()).toBe(true);

      // Local Ollama must NOT receive Gemini or Anthropic legacy credentials as Bearer token
      const ollamaScope = nock('http://localhost:11434', {
        badheaders: ['authorization']
      })
        .post('/v1/chat/completions')
        .reply(HTTP_STATUS.OK, {
          choices: [{ message: { content: JSON.stringify(validSynthesisPayload) } }]
        });

      const ollamaAdapter = createReasoningAdapter({
        maxRetries: 0,
        retryDelayMs: 0,
        env: { ...sharedLegacyEnv, LLM_PROVIDER: 'ollama' }
      });
      await ollamaAdapter.synthesizeRcaAndPatch(sampleEvidence);
      expect(ollamaScope.isDone()).toBe(true);
    });

    it('should_resolve_provider_specific_default_models_in_system_settings_when_LLM_MODEL_is_unset', () => {
      const openAiSettings = resolveDefaultSystemSettings({ LLM_PROVIDER: 'openai' });
      expect(openAiSettings.llmModel).toBe('gpt-4o-mini');

      const openRouterSettings = resolveDefaultSystemSettings({ LLM_PROVIDER: 'openrouter' });
      expect(openRouterSettings.llmModel).toBe('openai/gpt-4o-mini');

      const vllmSettings = resolveDefaultSystemSettings({ LLM_PROVIDER: 'vllm' });
      expect(vllmSettings.llmModel).toBe('Qwen/Qwen2.5-Coder-7B-Instruct');

      const anthropicSettings = resolveDefaultSystemSettings({ LLM_PROVIDER: 'anthropic' });
      expect(anthropicSettings.llmModel).toBe('claude-sonnet-5-5');
      expect(anthropicSettings.llmFallbackModel).toBe('claude-haiku-5-5');
    });
  });
});
