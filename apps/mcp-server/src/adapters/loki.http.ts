import type { LogsPort, LokiQueryInput, LogsQueryResult } from '../ports/index.js';
import { isArray, isString } from '@zeromttr/utils';
import { buildUrl } from '@zeromttr/utils/http';

export interface LokiAdapterConfig {
  baseUrl: string;
}

export class LokiHttpAdapter implements LogsPort {
  constructor(private readonly config: LokiAdapterConfig) {}

  async queryLogs(input: LokiQueryInput): Promise<LogsQueryResult> {
    const url = buildUrl(this.config.baseUrl, '/loki/api/v1/query_range', {
      query: input.logql,
      start: input.start,
      end: input.end,
      limit: input.limit
    });
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
    if (data.status === 'success' && data.data && isArray(data.data.result)) {
      for (const item of data.data.result) {
        if (isArray(item.values)) {
          for (const val of item.values) {
            if (isArray(val) && isString(val[1])) {
              lines.push(val[1]);
            }
          }
        }
      }
    }

    return { rawBytes, lines };
  }
}
