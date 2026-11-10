import type { TracesPort, TraceSearchResult } from '../ports/traces.port.js';

export interface SearchTracesByTraceQLInput {
  query: string;
  limit?: number;
}

export interface SearchTracesByTraceQLOutput {
  query: string;
  count: number;
  traces: TraceSearchResult[];
}

export class SearchTracesByTraceQL {
  constructor(private readonly tracesPort: TracesPort) {}

  async execute(input: SearchTracesByTraceQLInput): Promise<SearchTracesByTraceQLOutput> {
    const safeLimit = Math.min(20, Math.max(1, input.limit ?? 10));
    const { traces } = await this.tracesPort.searchTraces(input.query, safeLimit);

    return {
      query: input.query,
      count: traces.length,
      traces: traces.slice(0, safeLimit)
    };
  }
}
