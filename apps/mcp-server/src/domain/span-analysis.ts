export interface RawSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  durationMs: number;
  statusCode?: string | number;
  statusMessage?: string;
  attributes?: Record<string, unknown>;
}

export interface TraceSummary {
  traceId: string;
  totalSpans: number;
  services_involved: string[];
  top5Errors: RawSpan[];
  top5Slowest: RawSpan[];
  rootSpan?: RawSpan;
  criticalSpan?: RawSpan;
}

export function extractOtelAttributeValue(val: unknown): unknown {
  if (val && typeof val === 'object') {
    if ('stringValue' in val) {
      return (val as { stringValue: string }).stringValue;
    }
    if ('boolValue' in val) {
      return (val as { boolValue: boolean }).boolValue;
    }
    if ('intValue' in val) {
      return Number((val as { intValue: string | number }).intValue);
    }
    if ('doubleValue' in val) {
      return Number((val as { doubleValue: number }).doubleValue);
    }
    if ('arrayValue' in val) {
      const values = (val as { arrayValue: { values?: unknown[] } }).arrayValue?.values;
      return Array.isArray(values) ? values.map(extractOtelAttributeValue) : [];
    }
  }
  return val;
}

export function isErrorSpan(span: RawSpan): boolean {
  if (
    span.statusCode === 2 ||
    span.statusCode === 'ERROR' ||
    span.statusCode === 'STATUS_CODE_ERROR'
  ) {
    return true;
  }
  if (span.attributes) {
    if (span.attributes['error'] === true || span.attributes['error'] === 'true') {
      return true;
    }
    const httpStatus = Number(
      span.attributes['http.status_code'] || span.attributes['http.response.status_code']
    );
    if (httpStatus >= 400) {
      return true;
    }
  }
  return false;
}

export function analyzeSpans(spans: RawSpan[]): TraceSummary {
  if (spans.length === 0) {
    return {
      traceId: '',
      totalSpans: 0,
      services_involved: [],
      top5Errors: [],
      top5Slowest: []
    };
  }

  const traceId = spans[0].traceId || '';
  const servicesSet = new Set<string>();

  for (const span of spans) {
    if (span.serviceName) {
      servicesSet.add(span.serviceName);
    }
  }

  const services_involved = Array.from(servicesSet).sort();

  // Root span has no parent or lowest parent
  const rootSpan = spans.find((s) => !s.parentSpanId) || spans[0];

  // Error spans
  const errorSpans = spans.filter(isErrorSpan);
  const top5Errors = [...errorSpans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

  // Slowest spans
  const top5Slowest = [...spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

  // Critical span: longest error span, or longest span overall
  const criticalSpan = top5Errors.length > 0 ? top5Errors[0] : top5Slowest[0];

  return {
    traceId,
    totalSpans: spans.length,
    services_involved,
    top5Errors,
    top5Slowest,
    rootSpan,
    criticalSpan
  };
}

export class SpanAnalyzer {
  static analyze(spans: RawSpan[]): TraceSummary {
    return analyzeSpans(spans);
  }
}
