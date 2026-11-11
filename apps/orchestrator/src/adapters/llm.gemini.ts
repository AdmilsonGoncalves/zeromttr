import { GoogleGenAI, Type } from '@google/genai';
import { isNonEmptyString, safeJsonParse } from '@zeromttr/utils';
import type { ReasoningPort, CollectedEvidence, RcaAndPatchSynthesis } from '../ports/index.js';

export const GEMINI_SYSTEM_INSTRUCTION = `Você é o ZeroMTTR Autonomous SRE Reasoner, um especialista em diagnóstico de causa raiz (RCA) e engenharia de remediação para microsserviços em produção.

Sua missão:
1. Analisar as evidências de telemetria coletadas (Prometheus, Loki, Tempo, Git Diff).
2. Identificar a causa raiz exata da anomalia, correlacionando a degradação de métricas com a regressão introduzida no diff de código.
3. Produzir uma explicação concisa em português brasileiro (pt-BR) para engenheiros de plantão.
4. Gerar o arquivo de código FONTE COMPLETO corrigido (patchedContent), restaurando a estabilidade operacional.

Regras estritas de segurança e código:
- O código corrigido em patchedContent deve conter o arquivo COMPLETO (não use reticências, nem trechos parciais).
- No serviço de pagamentos (payment.repository.ts), garanta impreterivelmente que conexões adquiridas do pool sejam liberadas em um bloco 'finally { client.release(); }' e que o tamanho do pool seja restaurado para safe defaults (max: 10).
- Nunca invente dependências ou altere assinaturas de métodos públicos.
- Responda obrigatoriamente no formato JSON estruturado conforme o schema solicitado.`;

export const RCA_SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Resumo executivo do incidente em 1 parágrafo'
    },
    rootCause: {
      type: Type.STRING,
      description: 'Explicação técnica detalhada da causa raiz encontrada no código'
    },
    evidenceRefs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Lista de referências de evidências'
    },
    suspectFilePath: {
      type: Type.STRING,
      description: 'Caminho do arquivo remediado'
    },
    patchedContent: {
      type: Type.STRING,
      description: 'Conteúdo integral do arquivo corrigido pronto para commit'
    },
    explanation: {
      type: Type.STRING,
      description: 'Explicação da alteração realizada no patch e como ela resolve o incidente'
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

    const prompt = `Analise as evidências do incidente e sintetize o RCA e o patch cirúrgico:\n${JSON.stringify(evidence, null, 2)}`;

    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 25_000;
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
    if (!text) {
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
    parsed.reasoningSource = 'llm';
    return parsed;
  }
}
