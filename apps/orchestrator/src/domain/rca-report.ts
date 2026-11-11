import type { PiiGuardAudit } from './pii-prompt-guard.js';
import type { EvidenceCoverageBreakdown } from './evidence-coverage.js';

export type ReasoningSource = 'llm' | 'fallback';

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  operationName: string;
  durationMs: number;
  hasError: boolean;
  errorMessage?: string;
}

export interface RcaReport {
  summary: string;
  rootCause?: string;
  reasoningSource: ReasoningSource;
  evidenceCoveragePercent: number;
  signalsCollected: number;
  signalsTotal: number;
  evidenceBreakdown?: EvidenceCoverageBreakdown;
  blastRadius: string[];
  diagnosisSeconds: number;
  traceId: string;
  criticalSpan: string;
  spans: SpanNode[];
  rawEdgeLogPreCollector?: string;
  logSample: string;
  piiGuardAudit: PiiGuardAudit;
  deployVersion?: string;
  mitigations: string[];
  grafanaAnnotationId?: number;
}
