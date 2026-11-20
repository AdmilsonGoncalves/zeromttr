import type { RawSpan } from '../domain/index.js';

export interface TraceSearchResult {
  traceId: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano?: string;
  durationMs?: number;
}

export interface TraceSearchWindow {
  start?: string;
  end?: string;
}

export interface TracesPort {
  getTrace(traceId: string): Promise<{ rawBytes: number; spans: RawSpan[] }>;
  searchTraces(
    query: string,
    limit?: number,
    window?: TraceSearchWindow
  ): Promise<{ rawBytes: number; traces: TraceSearchResult[] }>;
}
