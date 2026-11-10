import type { TracesPort } from '../ports/traces.port.js';
import { SpanAnalyzer, type RawSpan } from '../domain/span-analysis.js';

export interface AnalyzeOtelTraceInput {
  trace_id: string;
}

export interface AnalyzeOtelTraceOutput {
  trace_id: string;
  total_spans: number;
  services_involved: string[];
  top_errors: RawSpan[];
  top_slowest: RawSpan[];
  root_span?: RawSpan;
  critical_span?: RawSpan;
}

export class AnalyzeOtelTrace {
  constructor(private readonly tracesPort: TracesPort) {}

  async execute(input: AnalyzeOtelTraceInput): Promise<AnalyzeOtelTraceOutput> {
    const traceId = input.trace_id.trim();
    if (!/^[0-9a-fA-F]{32}$/.test(traceId)) {
      throw new Error(
        `Invalid trace_id: '${input.trace_id}'. Must be a 32-character hexadecimal string.`
      );
    }

    const { spans } = await this.tracesPort.getTrace(traceId);
    const summary = SpanAnalyzer.analyze(spans);

    return {
      trace_id: traceId,
      total_spans: summary.totalSpans,
      services_involved: summary.services_involved,
      top_errors: summary.top5Errors,
      top_slowest: summary.top5Slowest,
      root_span: summary.rootSpan,
      critical_span: summary.criticalSpan
    };
  }
}
