import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { DeterministicFallbackReasoningAdapter } from '../../src/adapters/llm.fallback.js';
import { createReasoningAdapter } from '../../src/adapters/llm.factory.js';
import { TypeScriptPatchSyntaxValidator } from '../../src/adapters/patch-syntax-validator.js';
import { DispatchRemediation } from '../../src/application/dispatch-remediation.js';
import { Incident } from '../../src/domain/incident.js';
import { IncidentState } from '../../src/domain/incident-state.js';
import type { CollectedEvidence } from '../../src/ports/reasoning.port.js';
import {
  createMockBroadcaster,
  createMockIncidentRepository,
  createMockToolsPort
} from '../helpers/test-doubles.helper.js';

const suspectFilePath = 'src/repositories/orders.repository.ts';
const originalFileContent = `export interface PoolConfig {
  max: number;
}

export const dbPoolConfig: PoolConfig = {
  max: 1
};
`;
const fixedFileContent = `export interface PoolConfig {
  max: number;
}

export const dbPoolConfig: PoolConfig = {
  max: 10
};
`;

const sampleEvidence: CollectedEvidence = {
  incidentId: 'inc-multi-llm-int-001',
  service: 'orders-api',
  alertName: 'HighLatency',
  promqlSummary: {
    metric: 'http_server_duration_milliseconds_bucket',
    p95LatencyMs: 4100,
    dbPoolWaiting: 6
  },
  traceAnalysis: {
    traceId: 'trace-multi-int-001',
    criticalOperation: 'pg.pool.acquire',
    durationMs: 3950,
    errorMessage: 'Pool timeout',
    servicesInvolved: ['orders-api', 'postgres']
  },
  logSample: 'ERROR pool exhausted [REDACTED_CPF]',
  gitDiff: {
    baseRef: 'v1.0.0',
    headRef: 'v1.0.1',
    suspectCommit: 'abc1234',
    authorLogin: 'dev-user',
    suspectFilePath,
    patch: '-  max: 10\n+  max: 1',
    suspectFileContent: originalFileContent
  }
};

const validSynthesis = {
  summary: 'Pool de conexões saturado após redução do limite para 1.',
  rootCause: 'A regressão alterou dbPoolConfig.max de 10 para 1.',
  evidenceRefs: ['trace-multi-int-001', 'abc1234'],
  suspectFilePath,
  patchedContent: fixedFileContent,
  explanation: 'Restaura dbPoolConfig.max para 10 preservando todas as exportações.'
};

describe('Multi-LLM DispatchRemediation integration', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    vi.restoreAllMocks();
  });

  it('should_synthesize_and_open_PR_with_reasoningSource_llm_via_OpenAI_compatible_provider', async () => {
    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .matchHeader('authorization', 'Bearer sk-openai-integration')
      .reply(HTTP_STATUS.OK, {
        choices: [{ message: { content: JSON.stringify(validSynthesis) } }]
      });

    const repository = createMockIncidentRepository();
    const incident = new Incident({
      id: sampleEvidence.incidentId,
      service: sampleEvidence.service,
      severity: 'critical',
      fingerprint: 'HighLatency:orders-api',
      state: IncidentState.ENRICHING
    });
    await repository.save(incident);

    const tools = createMockToolsPort();
    const broadcaster = createMockBroadcaster();
    const llmAdapter = createReasoningAdapter({
      maxRetries: 0,
      retryDelayMs: 0,
      env: {
        LLM_PROVIDER: 'openai',
        LLM_API_KEY: 'sk-openai-integration'
      }
    });
    const fallbackAdapter = new DeterministicFallbackReasoningAdapter({
      patchTemplate: fixedFileContent
    });

    const useCase = new DispatchRemediation(
      repository,
      tools,
      llmAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      { syntaxValidator: new TypeScriptPatchSyntaxValidator() }
    );

    const result = await useCase.execute(incident.id, sampleEvidence, 'blob-sha-1');

    expect(scope.isDone()).toBe(true);
    expect(result.reasoningSource).toBe('llm');
    expect(result.rcaReport.reasoningSource).toBe('llm');
    expect(tools.createRemediationPr).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: suspectFilePath,
        patched_content: fixedFileContent,
        reasoning_source: 'llm'
      })
    );
  });

  it('should_synthesize_with_reasoningSource_llm_via_Anthropic_and_fallback_cleanly_on_upstream_error', async () => {
    const anthropicScope = nock('https://api.anthropic.com')
      .post('/v1/messages')
      .matchHeader('x-api-key', 'sk-ant-integration')
      .reply(HTTP_STATUS.OK, {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_int_1',
            name: 'submit_rca_and_patch',
            input: validSynthesis
          }
        ]
      });

    const repository = createMockIncidentRepository();
    const incidentOk = new Incident({
      id: 'inc-anthropic-ok',
      service: sampleEvidence.service,
      severity: 'critical',
      fingerprint: 'HighLatency:orders-api',
      state: IncidentState.ENRICHING
    });
    await repository.save(incidentOk);

    const tools = createMockToolsPort();
    const broadcaster = createMockBroadcaster();
    const anthropicAdapter = createReasoningAdapter({
      maxRetries: 0,
      retryDelayMs: 0,
      fallbackModelName: '',
      env: {
        LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'sk-ant-integration'
      }
    });
    const fallbackAdapter = new DeterministicFallbackReasoningAdapter({
      patchTemplate: fixedFileContent
    });

    const useCase = new DispatchRemediation(
      repository,
      tools,
      anthropicAdapter,
      fallbackAdapter,
      broadcaster,
      undefined,
      { syntaxValidator: new TypeScriptPatchSyntaxValidator() }
    );

    const okResult = await useCase.execute(incidentOk.id, sampleEvidence, 'blob-sha-2');
    expect(anthropicScope.isDone()).toBe(true);
    expect(okResult.reasoningSource).toBe('llm');

    // Now simulate upstream 503 failure -> must route cleanly to deterministic fallback
    nock('https://api.anthropic.com')
      .post('/v1/messages')
      .reply(HTTP_STATUS.SERVICE_UNAVAILABLE, { error: 'overloaded' });

    const incidentFallback = new Incident({
      id: 'inc-anthropic-fallback',
      service: sampleEvidence.service,
      severity: 'critical',
      fingerprint: 'HighLatency:orders-api:2',
      state: IncidentState.ENRICHING
    });
    await repository.save(incidentFallback);

    const fallbackResult = await useCase.execute(incidentFallback.id, sampleEvidence, 'blob-sha-3');
    expect(fallbackResult.reasoningSource).toBe('fallback');
    expect(fallbackResult.rcaReport.reasoningSource).toBe('fallback');
    expect(tools.createRemediationPr).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reasoning_source: 'fallback'
      })
    );
  });
});
