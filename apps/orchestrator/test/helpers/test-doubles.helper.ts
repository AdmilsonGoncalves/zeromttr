import { vi } from 'vitest';
import type { Clock } from '../../src/ports/clock.port.js';
import type { EventBroadcasterPort } from '../../src/ports/event-broadcaster.port.js';
import type { FinOpsData, ToolsPort } from '../../src/ports/tools.port.js';
import type { IncidentRepository } from '../../src/ports/incident-repository.port.js';
import type { ReasoningPort } from '../../src/ports/reasoning.port.js';
import type { TargetStatus, TargetStatusPort } from '../../src/ports/target-status.port.js';
import { TargetHealthStatus } from '../../src/domain/incident-enums.js';
import type { Incident } from '../../src/domain/incident.js';
import { HandleAlert } from '../../src/application/handle-alert.js';
import { OrchestratorWorkflow } from '../../src/application/orchestrator-workflow.js';
import { RecordDecision } from '../../src/application/record-decision.js';
import { SimulateDemoDecision } from '../../src/demo/simulate-demo-decision.js';
import type { DemoControlPort } from '../../src/demo/demo-control.port.js';

export function createMockFinOpsData(overrides: Partial<FinOpsData> = {}): FinOpsData {
  return {
    rawBytesFetched: 1000,
    compactedBytesSentToLlm: 200,
    payloadReductionPercent: 80,
    estimatedTokensSaved: 200,
    ...overrides
  };
}

export function createMockIncidentRepository(
  initialIncidents: Incident[] = []
): IncidentRepository {
  const store = new Map<string, Incident>();
  for (const inc of initialIncidents) {
    store.set(inc.id, inc);
  }

  return {
    findById: vi.fn(async (id: string) => store.get(id) ?? null),
    findOpenByFingerprint: vi.fn(async (fp: string) => {
      for (const inc of store.values()) {
        if (inc.fingerprint === fp) {
          return inc;
        }
      }
      return null;
    }),
    findAll: vi.fn(async () => Array.from(store.values())),
    save: vi.fn(async (incident: Incident) => {
      store.set(incident.id, incident);
    })
  };
}

export function createMockToolsPort(overrides: Partial<ToolsPort> = {}): ToolsPort {
  return {
    executePromqlRange: vi.fn(async () => ({
      seriesCount: 0,
      summarizedSeries: [],
      finops: createMockFinOpsData()
    })),
    queryLokiLogs: vi.fn(async () => ({
      linesReturned: 0,
      logs: [],
      finops: createMockFinOpsData()
    })),
    analyzeOtelTrace: vi.fn(async () => ({
      traceId: 'trace-default',
      totalDurationMs: 100,
      servicesInvolved: ['api-service'],
      criticalSpans: []
    })),
    searchTracesByTraceQL: vi.fn(async () => ({
      traces: []
    })),
    inspectGitDeployDiff: vi.fn(async () => ({
      suspectCommitSha: 'commit-sha-default',
      authorLogin: 'dev',
      commitMessage: 'chore: default commit message',
      suspectFilePath: 'src/index.ts',
      currentBlobSha: 'blob-sha-default',
      truncatedPatch: '',
      finops: createMockFinOpsData()
    })),
    createRemediationPr: vi.fn(async () => ({
      branchName: 'hotfix/zeromttr-default',
      branchUrl: 'https://github.com/example/repo/tree/hotfix/zeromttr-default',
      pullRequestUrl: 'https://github.com/example/repo/pull/1',
      commitSha: 'commit-pr-default'
    })),
    sendPostMortemResend: vi.fn(async () => ({
      emailId: 'email-default',
      sentAt: '2026-11-10T12:00:00.000Z'
    })),
    annotateGrafanaIncident: vi.fn(async () => ({
      annotationId: 1,
      success: true
    })),
    ...overrides
  };
}

export function createMockTargetStatusPort(
  overrides: Partial<TargetStatus> = {}
): TargetStatusPort {
  return {
    getStatus: vi.fn(async () => ({
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      targetRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      rawEdgeLogPreCollector: 'raw',
      ...overrides
    }))
  };
}

export function createMockDemoControlPort(
  overrides: Partial<DemoControlPort> = {}
): DemoControlPort {
  return {
    triggerChaos: vi.fn(async () => {}),
    toggleHealthyTraffic: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    ...overrides
  };
}

export function createMockBroadcaster(): EventBroadcasterPort & {
  broadcast: ReturnType<typeof vi.fn<(event: string, data: unknown) => void>>;
} {
  return {
    broadcast: vi.fn<(event: string, data: unknown) => void>()
  };
}

export function createMockClock(nowMs = 1730000000000, iso = '2026-11-10T12:00:00.000Z'): Clock {
  return {
    now: vi.fn(() => nowMs),
    iso: vi.fn(() => iso)
  };
}

export function createMockReasoningPort(overrides: Partial<ReasoningPort> = {}): ReasoningPort {
  return {
    synthesizeRcaAndPatch: vi.fn(async () => ({
      summary: 'Synthesized RCA summary',
      rootCause: 'Synthesized root cause',
      evidenceRefs: ['trace-1'],
      suspectFilePath: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      patchedContent: 'export const ok = true;',
      explanation: 'Synthesized explanation',
      reasoningSource: 'llm' as const
    })),
    ...overrides
  };
}

export function createStubHandleAlert(repo?: IncidentRepository): HandleAlert {
  return new HandleAlert(repo ?? createMockIncidentRepository(), createMockBroadcaster());
}

export function createStubRecordDecision(
  repo?: IncidentRepository,
  hmacSecret = 'test-hmac-secret'
): RecordDecision {
  return new RecordDecision(
    repo ?? createMockIncidentRepository(),
    createMockToolsPort(),
    createMockClock(),
    createMockBroadcaster(),
    hmacSecret
  );
}

export function createStubSimulateDemoDecision(repo?: IncidentRepository): SimulateDemoDecision {
  return new SimulateDemoDecision(
    repo ?? createMockIncidentRepository(),
    createMockToolsPort(),
    createMockBroadcaster()
  );
}

export function createStubWorkflow(
  overrides: Partial<OrchestratorWorkflow> = {}
): OrchestratorWorkflow {
  const workflow = Object.create(OrchestratorWorkflow.prototype);
  workflow.runFullPipeline = vi.fn(async () => {});
  return Object.assign(workflow, overrides);
}
