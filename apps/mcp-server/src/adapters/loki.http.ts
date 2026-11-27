import type { LogsPort, LokiQueryInput, LogsQueryResult } from '../ports/logs.port.js';
import { isArray, isString, safeJsonParse } from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, buildUrl, isHttpSuccess } from '@zeromttr/utils/http';

export interface LokiAdapterConfig {
  baseUrl: string;
}

/**
 * Grafana Loki HTTP adapter executing LogQL range queries and measuring raw fetched byte volume.
 */
export class LokiHttpAdapter implements LogsPort {
  constructor(private readonly config: LokiAdapterConfig) {}

  /**
   * Executes a LogQL range query against Loki and returns extracted log lines with raw byte size.
   */
  async queryLogs(input: LokiQueryInput): Promise<LogsQueryResult> {
    const url = buildUrl(this.config.baseUrl, '/loki/api/v1/query_range', {
      query: input.logql,
      start: input.start,
      end: input.end,
      limit: input.limit
    });
    const response = await fetch(url, {
      headers: { [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON }
    });

    if (!isHttpSuccess(response.status)) {
      throw new Error(`Loki query failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const rawBytes = Buffer.byteLength(text, 'utf-8');

    const data = safeJsonParse<{
      status?: string;
      data?: {
        result?: Array<{
          stream?: Record<string, string>;
          values?: [string, string][];
        }>;
      };
    }>(text);
    if (!data) {
      throw new Error('Failed to parse Loki JSON response');
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
