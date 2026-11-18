import { GoogleGenAI, Type } from '@google/genai';
import { isNonEmptyString, parseNumber, safeJsonParse } from '@zeromttr/utils';
import { ReasoningProvider } from '../domain/index.js';
import type { ReasoningPort, CollectedEvidence, RcaAndPatchSynthesis } from '../ports/index.js';

export const GEMINI_SYSTEM_INSTRUCTION = `You are the ZeroMTTR Autonomous SRE Reasoner, a specialist in Root Cause Analysis (RCA) and remediation engineering for production microservices.

Your mission:
1. Analyze the collected telemetry evidence (Prometheus, Loki, Tempo, Git Diff).
2. Identify the exact root cause of the anomaly, correlating metric degradation with the regression introduced in the code diff.
3. Produce a concise explanation in English for on-call engineers.
4. Generate the COMPLETE fixed source code file (patchedContent), restoring operational stability.

Strict security and coding rules:
- The fixed code in patchedContent MUST contain the COMPLETE file (never use ellipses or partial snippets).
- Preserve the suspectFilePath identified in the deploy diff and fix the root cause of the regression (such as resource leaks, missing cleanup in finally blocks, or degraded pool/timeout settings), restoring the healthy baseline behavior.
- Never invent dependencies or alter public method signatures.
- You must respond strictly in structured JSON matching the requested schema.`;

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

export class GeminiReasoningAdapter implements ReasoningPort {
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;
  private readonly modelName: string;

  public constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.client = new GoogleGenAI({ apiKey: this.apiKey || 'placeholder-for-instantiation' });
    this.modelName = modelName || process.env.LLM_MODEL || 'gemini-3.5-flash';
  }

  public async synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis> {
    if (!isNonEmptyString(this.apiKey) || this.apiKey === 'change-me-gemini-api-key') {
      throw new Error('Gemini API key is not configured');
    }

    const prompt = `Analyze the incident evidence and synthesize the RCA and surgical patch:\n${JSON.stringify(evidence, null, 2)}`;

    const timeoutMs = parseNumber(process.env.GEMINI_TIMEOUT_MS, 25_000);
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
          model: this.modelName,
          contents: prompt,
          config: {
            systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
            temperature: 0.1,
            maxOutputTokens: 4096,
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

    const text = response.text;
    if (!isNonEmptyString(text)) {
      throw new Error('Empty response from Gemini LLM');
    }

    const parsed = safeJsonParse<RcaAndPatchSynthesis>(text);
    if (
      !parsed ||
      !isNonEmptyString(parsed.summary) ||
      !isNonEmptyString(parsed.patchedContent) ||
      !isNonEmptyString(parsed.suspectFilePath)
    ) {
      throw new Error(
        'Failed to parse structured JSON response from Gemini or missing required schema fields'
      );
    }
    parsed.reasoningSource = ReasoningProvider.LLM;
    return parsed;
  }
}
