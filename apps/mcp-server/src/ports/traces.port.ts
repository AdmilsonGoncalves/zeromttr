import type { RawSpan } from '../domain/index.js';

export interface TraceSearchResult {
  traceId: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano?: string;
  durationMs?: number;
}

export interface TracesPort {
  getTrace(traceId: string): Promise<{ rawBytes: number; spans: RawSpan[] }>;
  searchTraces(
    query: string,
    limit?: number
  ): Promise<{ rawBytes: number; traces: TraceSearchResult[] }>;
}
