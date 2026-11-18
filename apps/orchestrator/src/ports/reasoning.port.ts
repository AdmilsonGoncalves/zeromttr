import type { ReasoningSource } from '../domain/index.js';

export interface CollectedEvidence {
  incidentId: string;
  service: string;
  alertName: string;
  promqlSummary: {
    metric: string;
    p95LatencyMs?: number;
    dbPoolWaiting?: number;
  };
  traceAnalysis: {
    traceId: string;
    criticalOperation: string;
    durationMs: number;
    errorMessage?: string;
    servicesInvolved: string[];
  };
  logSample: string;
  gitDiff: {
    baseRef: string;
    headRef: string;
    suspectCommit: string;
    authorLogin: string;
    suspectFilePath: string;
    patch: string;
  };
  signals?: {
    hasPromqlAnomaly?: boolean;
    hasMetricExemplar?: boolean;
    hasTempoErrorSpan?: boolean;
    hasLokiLogAndGitDiff?: boolean;
  };
}

export interface RcaAndPatchSynthesis {
  summary: string;
  rootCause: string;
  evidenceRefs: string[];
  suspectFilePath: string;
  patchedContent: string;
  explanation: string;
  reasoningSource?: ReasoningSource;
}

export interface ReasoningPort {
  synthesizeRcaAndPatch(evidence: CollectedEvidence): Promise<RcaAndPatchSynthesis>;
}
