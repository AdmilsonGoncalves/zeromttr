import { clamp, isEmpty, isFilled, nowIso } from '@zeromttr/utils';
import type { TracesPort, TraceSearchResult } from '../ports/traces.port.js';
import { validateTimeRange } from './validate-time-range.js';

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
    if (isEmpty(input.start) && isFilled(input.end)) {
      throw new Error("Invalid time window: 'start' is required when 'end' is provided.");
    }

    let traces: TraceSearchResult[];
    if (isFilled(input.start)) {
      const { startIso, endIso } = validateTimeRange(
        input.start,
        isFilled(input.end) ? input.end : nowIso()
      );
      ({ traces } = await this.tracesPort.searchTraces(input.query, safeLimit, {
        start: startIso,
        end: endIso
      }));
    } else {
      ({ traces } = await this.tracesPort.searchTraces(input.query, safeLimit));
    }

    return {
      query: input.query,
      count: traces.length,
      traces: traces.slice(0, safeLimit)
    };
  }
}
