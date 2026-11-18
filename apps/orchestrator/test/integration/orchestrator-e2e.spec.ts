import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  DeterministicFallbackReasoningAdapter,
  FileIncidentRepository,
  HttpTargetStatusAdapter,
  McpClientAdapter
} from '../../src/adapters/index.js';
import {
  DispatchRemediation,
  EnrichWithDeployDiff,
  HandleAlert,
  InvestigateIncident,
  NotifyOnCall,
  OrchestratorWorkflow,
  RecordDecision
} from '../../src/application/index.js';
import { IncidentState } from '../../src/domain/index.js';
import { createApp, SseEventBroadcaster } from '../../src/http/index.js';
import {
  cleanOrchestratorNock,
  mockMcpJsonRpcEndpoint,
  mockTargetAppStatusEndpoint,
  setupOrchestratorNock,
  teardownOrchestratorNock,
  TEST_MCP_BASE_URL,
  TEST_TARGET_APP_URL
} from '../helpers/nock.helper.js';
import { createMockClock, createMockReasoningPort } from '../helpers/test-doubles.helper.js';

async function waitForIncidentState(
  app: Express,
  dashboardToken: string,
  incidentId: string,
  targetStates: IncidentState[],
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let lastStatus = 0;
  let lastBody: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    const res = await request(app)
      .get(`/api/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${dashboardToken}`);
    lastStatus = res.status;
    lastBody = res.body;
    if (res.status === 200 && targetStates.includes(res.body.state as IncidentState)) {
      return res.body as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for incident '${incidentId}' to reach ${targetStates.join('/')}. Last (${lastStatus}): ${JSON.stringify(lastBody)}`
  );
}

describe('Orchestrator End-to-End Integration with Nock (Happy Path & PII Fail-Closed)', () => {
  const GRAFANA_TOKEN = 'e2e-grafana-token-123';
  const DASHBOARD_TOKEN = 'e2e-dashboard-token-456';
  const MCP_TOKEN = 'e2e-mcp-token-789';
  const HMAC_SECRET = 'e2e-hmac-secret-zeromttr-2026';

  let tempDir: string;
  let broadcasters: SseEventBroadcaster[] = [];

  beforeAll(() => {
    setupOrchestratorNock();
  });

  afterAll(() => {
    teardownOrchestratorNock();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-e2e-'));
    broadcasters = [];
  });

  afterEach(() => {
    cleanOrchestratorNock();
    for (const b of broadcasters) {
      b.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function buildE2eApp(llmAdapter = createMockReasoningPort()): {
    app: Express;
    llmAdapter: ReturnType<typeof createMockReasoningPort>;
  } {
    const storePath = path.join(tempDir, 'incidents.json');
    const repository = new FileIncidentRepository(storePath);
    const targetStatusPort = new HttpTargetStatusAdapter(TEST_TARGET_APP_URL);
    const toolsPort = new McpClientAdapter(`${TEST_MCP_BASE_URL}/mcp`, MCP_TOKEN);
    const fallbackAdapter = new DeterministicFallbackReasoningAdapter();
    const clock = createMockClock(Math.floor(Date.now()));
    const broadcaster = new SseEventBroadcaster(60_000);
    broadcasters.push(broadcaster);

    const handleAlert = new HandleAlert(repository, broadcaster);
    const investigateIncident = new InvestigateIncident(
      repository,
      toolsPort,
      targetStatusPort,
      broadcaster
    );
    const enrichWithDeployDiff = new EnrichWithDeployDiff(repository, toolsPort, broadcaster);
    const dispatchRemediation = new DispatchRemediation(
      repository,
      toolsPort,
      llmAdapter,
      fallbackAdapter,
      broadcaster
    );
    const notifyOnCall = new NotifyOnCall(
      repository,
      toolsPort,
      clock,
      broadcaster,
      HMAC_SECRET,
      'https://zeromttr.agjworks.com'
    );
    const recordDecision = new RecordDecision(
      repository,
      toolsPort,
      clock,
      broadcaster,
      HMAC_SECRET
    );

    const workflow = new OrchestratorWorkflow(
      repository,
      investigateIncident,
      enrichWithDeployDiff,
      dispatchRemediation,
      notifyOnCall,
      broadcaster
    );

    const app = createApp({
      repository,
      targetStatusPort,
      handleAlert,
      orchestratorWorkflow: workflow,
      recordDecision,
      broadcaster,
      grafanaWebhookToken: GRAFANA_TOKEN,
      dashboardApiToken: DASHBOARD_TOKEN,
      liveDemoKey: ''
    });

    return { app, llmAdapter };
  }

  it('should execute full webhook -> MCP nock -> LLM -> PR -> Resend HMAC -> decision -> 409 lifecycle', async () => {
    mockTargetAppStatusEndpoint();
    const { captured } = mockMcpJsonRpcEndpoint(MCP_TOKEN);
    const { app, llmAdapter } = buildE2eApp();

    const webhookRes = await request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', `Bearer ${GRAFANA_TOKEN}`)
      .send({
        alerts: [
          {
            status: 'firing',
            labels: {
              alertname: 'PaymentServicePoolExhaustion',
              service: 'api-pagamentos-core',
              severity: 'critical'
            }
          }
        ]
      });

    expect(webhookRes.status).toBe(202);
    const incidentId = webhookRes.body.incidentId as string;
    expect(incidentId).toBeDefined();

    const detail = await waitForIncidentState(app, DASHBOARD_TOKEN, incidentId, [
      IncidentState.NOTIFIED,
      IncidentState.FAILED
    ]);

    if (detail.state === IncidentState.FAILED) {
      throw new Error(`Pipeline failed: ${JSON.stringify(detail.transitions)}`);
    }
    expect(detail.state).toBe(IncidentState.NOTIFIED);
    expect(detail.alertName).toBe('PaymentServicePoolExhaustion');
    expect(llmAdapter.synthesizeRcaAndPatch).toHaveBeenCalledTimes(1);

    const rca = detail.rca as Record<string, unknown>;
    expect(rca.reasoningSource).toBe('llm');
    expect(rca.evidenceCoveragePercent).toBe(100);
    expect((rca.piiGuardAudit as Record<string, unknown>).passed).toBe(true);

    // Ensure HMAC signatures are NEVER leaked in REST detail
    expect(detail.approveSig).toBeUndefined();
    expect(detail.rejectSig).toBeUndefined();
    expect(detail.sig).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain('sig=');

    // Verify PR creation via MCP nock
    expect(captured.createPrArgs).toBeDefined();
    expect(captured.createPrArgs?.reasoning_source).toBe('llm');

    // Extract HMAC signatures strictly from Resend email fragment
    const approveUrl = String(captured.sendPostMortemArgs?.approve_url ?? '');
    const rejectUrl = String(captured.sendPostMortemArgs?.reject_url ?? '');
    expect(approveUrl).toContain('#action=approve&sig=');
    expect(rejectUrl).toContain('#action=reject&sig=');

    const approveParams = new URLSearchParams(new URL(approveUrl).hash.slice(1));
    const sig = approveParams.get('sig');
    const exp = Number(approveParams.get('exp'));
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(exp).toBeGreaterThan(0);

    const rejectParams = new URLSearchParams(new URL(rejectUrl).hash.slice(1));
    const rejectSig = rejectParams.get('sig');
    const rejectExp = Number(rejectParams.get('exp'));

    // Confirm decision with HMAC signature
    const decisionRes = await request(app)
      .post(`/api/incidents/${incidentId}/decision`)
      .send({ action: 'approve', sig, exp });

    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.state).toBe(IncidentState.RESOLVED);
    expect(decisionRes.body.decisionSource).toBe('email_hmac');

    // Second decision attempt with valid reject HMAC signature must return 409 Conflict
    const replayDecisionRes = await request(app)
      .post(`/api/incidents/${incidentId}/decision`)
      .send({ action: 'reject', sig: rejectSig, exp: rejectExp });

    expect(replayDecisionRes.status).toBe(409);
  });

  it('should fail-closed to deterministic fallback via nock when Loki log leaks a valid CPF', async () => {
    const syntheticCpf = '529.982.247-25';
    mockTargetAppStatusEndpoint();
    const { captured } = mockMcpJsonRpcEndpoint(MCP_TOKEN, {
      lokiLines: [`[2026-11-10T12:00:01Z] ERROR transaction failed for cpf=${syntheticCpf}`]
    });
    const { app, llmAdapter } = buildE2eApp();

    const webhookRes = await request(app)
      .post('/webhook/grafana-alert')
      .set('Authorization', `Bearer ${GRAFANA_TOKEN}`)
      .send({
        alerts: [
          {
            status: 'firing',
            labels: {
              alertname: 'PaymentServicePoolExhaustion',
              service: 'api-pagamentos-core',
              severity: 'critical'
            }
          }
        ]
      });

    expect(webhookRes.status).toBe(202);
    const incidentId = webhookRes.body.incidentId as string;

    const detail = await waitForIncidentState(app, DASHBOARD_TOKEN, incidentId, [
      IncidentState.NOTIFIED,
      IncidentState.FAILED
    ]);

    if (detail.state === IncidentState.FAILED) {
      throw new Error(`Pipeline failed: ${JSON.stringify(detail.transitions)}`);
    }
    expect(detail.state).toBe(IncidentState.NOTIFIED);
    // CRITICAL: LLM adapter must NEVER be called when PII guard triggers
    expect(llmAdapter.synthesizeRcaAndPatch).not.toHaveBeenCalled();

    const rca = detail.rca as Record<string, unknown>;
    expect(rca.reasoningSource).toBe('fallback');
    expect(rca.logSample).toBe('[WITHHELD DUE TO PII VIOLATION: cpf_dotted]');
    expect((rca.piiGuardAudit as Record<string, unknown>).passed).toBe(false);
    expect((rca.piiGuardAudit as Record<string, unknown>).leakedPatternsDetected).toBe(1);

    // Ensure raw CPF never leaks in REST or PR payload
    expect(JSON.stringify(detail)).not.toContain(syntheticCpf);
    expect(JSON.stringify(captured.createPrArgs)).not.toContain(syntheticCpf);
  });
});
