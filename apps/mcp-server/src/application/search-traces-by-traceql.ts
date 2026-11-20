import { clamp } from '@zeromttr/utils';
import type { TracesPort, TraceSearchResult } from '../ports/index.js';

export interface SearchTracesByTraceQLInput {
  query: string;
  limit?: number;
  start?: string;
  end?: string;
}

export interface SearchTracesByTraceQLOutput {
  query: string;
  count: number;
  traces: TraceSearchResult[];
}

export class SearchTracesByTraceQL {
  constructor(private readonly tracesPort: TracesPort) {}

  async execute(input: SearchTracesByTraceQLInput): Promise<SearchTracesByTraceQLOutput> {
    const safeLimit = clamp(input.limit ?? 10, 1, 20);
    const hasWindow = input.start !== undefined || input.end !== undefined;
    const { traces } = hasWindow
      ? await this.tracesPort.searchTraces(input.query, safeLimit, {
          start: input.start,
          end: input.end
        })
      : await this.tracesPort.searchTraces(input.query, safeLimit);

    return {
      query: input.query,
      count: traces.length,
      traces: traces.slice(0, safeLimit)
    };
  }
}
