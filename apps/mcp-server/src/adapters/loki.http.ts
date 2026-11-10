import type { LogsPort, LokiQueryInput, LogsQueryResult } from '../ports/logs.port.js';

export interface LokiAdapterConfig {
  baseUrl: string;
}

export class LokiHttpAdapter implements LogsPort {
  constructor(private readonly config: LokiAdapterConfig) {}

  async queryLogs(input: LokiQueryInput): Promise<LogsQueryResult> {
    const params = new URLSearchParams({
      query: input.logql,
      start: input.start,
      end: input.end
    });
    if (input.limit) {
      params.append('limit', String(input.limit));
    }

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/loki/api/v1/query_range?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Loki query failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    let data: {
      status?: string;
      data?: {
        result?: Array<{
          stream?: Record<string, string>;
          values?: [string, string][];
        }>;
      };
    };
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse Loki JSON response: ${(err as Error).message}`);
    }

    const lines: string[] = [];
    if (data.status === 'success' && data.data && Array.isArray(data.data.result)) {
      for (const item of data.data.result) {
        if (Array.isArray(item.values)) {
          for (const val of item.values) {
            if (Array.isArray(val) && typeof val[1] === 'string') {
              lines.push(val[1]);
            }
          }
        }
      }
    }

    return { rawBytes, lines };
  }
}
