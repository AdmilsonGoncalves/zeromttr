import { isArray, isNonEmptyArray, isNonEmptyString, isObject } from '@zeromttr/utils';

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

/**
 * Unwraps OpenTelemetry attribute value wrappers (`stringValue`, `intValue`, `arrayValue`, etc.) into primitives.
 */
export function extractOtelAttributeValue(val: unknown): unknown {
  if (isObject(val)) {
    if ('stringValue' in val) {
      return val.stringValue;
    }
    if ('boolValue' in val) {
      return val.boolValue;
    }
    if ('intValue' in val) {
      return Number(val.intValue);
    }
    if ('doubleValue' in val) {
      return Number(val.doubleValue);
    }
    if ('arrayValue' in val && isObject(val.arrayValue)) {
      const values = val.arrayValue.values;
      return isArray(values) ? values.map(extractOtelAttributeValue) : [];
    }
  }
  return val;
}

/**
 * Determines whether a normalized span represents an error or HTTP 4xx/5xx failure.
 */
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

/**
 * Summarizes a trace's spans into involved services, root/critical spans, and top error/slowest lists.
 */
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
    if (isNonEmptyString(span.serviceName)) {
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
  const criticalSpan = isNonEmptyArray<RawSpan>(top5Errors) ? top5Errors[0] : top5Slowest[0];

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
  /**
   * Analyzes raw trace spans into a structured trace summary.
   */
  static analyze(spans: RawSpan[]): TraceSummary {
    return analyzeSpans(spans);
  }
}
