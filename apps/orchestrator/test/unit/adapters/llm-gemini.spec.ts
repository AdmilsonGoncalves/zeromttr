import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiReasoningAdapter } from '../../../src/adapters/llm.gemini.js';
import type { CollectedEvidence } from '../../../src/ports/index.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY'
  },
  GoogleGenAI: class {
    public models = {
      generateContent: mockGenerateContent
    };
  }
}));

describe('GeminiReasoningAdapter', () => {
  const sampleEvidence: CollectedEvidence = {
    incidentId: 'inc-gemini-001',
    service: 'orders-api',
    alertName: 'HighErrorRate',
    promqlSummary: {
      metric: 'http_server_duration_milliseconds_bucket',
      p95LatencyMs: 3200
    },
    traceAnalysis: {
      traceId: 'trace-abc',
      criticalOperation: 'db.query',
      durationMs: 3100,
      servicesInvolved: ['orders-api']
    },
    logSample: 'ERROR connection timeout',
    gitDiff: {
      baseRef: 'v1.0.0',
      headRef: 'v1.0.1',
      suspectCommit: 'sha-123',
      authorLogin: 'dev',
      suspectFilePath: 'src/db.ts',
      patch: '- max: 10\n+ max: 1'
    }
  };

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    delete process.env.GEMINI_TIMEOUT_MS;
  });

  it('should reject empty or placeholder Gemini API keys', async () => {
    const adapterMissing = new GeminiReasoningAdapter('', 'gemini-3.5-flash');
    await expect(adapterMissing.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
      'Gemini API key is not configured'
    );

    const adapterPlaceholder = new GeminiReasoningAdapter('change-me-gemini-api-key');
    await expect(adapterPlaceholder.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
      'Gemini API key is not configured'
    );
  });

  it('should synthesize structured RCA and patch when Gemini returns valid JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: 'Pool exhausted due to max=1',
        rootCause: 'Connection pool cap reduced from 10 to 1',
        evidenceRefs: ['trace-abc', 'sha-123'],
        suspectFilePath: 'src/db.ts',
        patchedContent: 'export const max = 10;',
        explanation: 'Restores max connections to 10'
      })
    });

    const adapter = new GeminiReasoningAdapter('real-looking-test-key', 'gemini-3.5-flash');
    const result = await adapter.synthesizeRcaAndPatch(sampleEvidence);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(result.reasoningSource).toBe('llm');
    expect(result.suspectFilePath).toBe('src/db.ts');
    expect(result.patchedContent).toBe('export const max = 10;');
  });

  it('should reject empty response text and malformed JSON from Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: '   ' });
    const adapter = new GeminiReasoningAdapter('real-looking-test-key');

    await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
      'Empty response from Gemini LLM'
    );

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ summary: 'Missing patchedContent' })
    });
    await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
      'Failed to parse structured JSON response from Gemini'
    );
  });

  it('should fail fast when Gemini call exceeds GEMINI_TIMEOUT_MS', async () => {
    process.env.GEMINI_TIMEOUT_MS = '20';
    mockGenerateContent.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Intentionally never resolves to simulate hung upstream call
        })
    );

    const adapter = new GeminiReasoningAdapter('real-looking-test-key');
    await expect(adapter.synthesizeRcaAndPatch(sampleEvidence)).rejects.toThrow(
      'Gemini generateContent timed out after 20ms'
    );
  });
});
