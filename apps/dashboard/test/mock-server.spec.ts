import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, type MockServer } from '../mock-server/server.js';
import type { IncidentDetail, TargetStatusResponse } from '../src/app/core/contract.js';

describe('Dashboard Mock Server', () => {
  let server: MockServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createMockServer({ heartbeatIntervalMs: 500 });
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should respond to GET /api/target/status', async () => {
    const res = await fetch(`${baseUrl}/api/target/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TargetStatusResponse;
    expect(body.service).toBe('api-pagamentos-core');
    expect(body.status).toBe('degraded');
    expect(body.version).toBe('v2.14.8');
  });

  it('should respond to GET /api/incidents', async () => {
    const res = await fetch(`${baseUrl}/api/incidents`);
    expect(res.status).toBe(200);
    const incidents = (await res.json()) as IncidentDetail[];
    expect(Array.isArray(incidents)).toBe(true);
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0]?.id).toBe('inc-20261110-001');
  });

  it('should respond to GET /api/incidents/:id', async () => {
    const res = await fetch(`${baseUrl}/api/incidents/inc-20261110-001`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as IncidentDetail;
    expect(detail.id).toBe('inc-20261110-001');
    expect(detail.rca?.evidenceCoveragePercent).toBe(100);
    expect(detail.rca?.reasoningSource).toBe('llm');
    expect(detail.finops?.payloadReductionPercent).toBe(84);
  });

  it('should handle POST /api/demo/chaos', async () => {
    const res = await fetch(`${baseUrl}/api/demo/chaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'live' })
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; mode: string };
    expect(body.status).toBe('chaos_injected');
    expect(body.mode).toBe('live');
  });

  it('should handle POST /api/demo/reset', async () => {
    const res = await fetch(`${baseUrl}/api/demo/reset`, {
      method: 'POST'
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('reset_completed');

    const statusRes = await fetch(`${baseUrl}/api/target/status`);
    const statusBody = (await statusRes.json()) as TargetStatusResponse;
    expect(statusBody.status).toBe('healthy');
  });

  it('should handle POST /api/demo/simulate-decision', async () => {
    const res = await fetch(`${baseUrl}/api/demo/simulate-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId: 'inc-20261110-001', action: 'approve' })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; action: string; source: string };
    expect(body.status).toBe('simulated');
    expect(body.action).toBe('approve');
    expect(body.source).toBe('demo_simulation');
  });

  it('should reject POST /api/incidents/:id/decision when expired or missing fields', async () => {
    // Missing fields
    const missingRes = await fetch(`${baseUrl}/api/incidents/inc-20261110-001/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' })
    });
    expect(missingRes.status).toBe(400);

    // Expired timestamp
    const expiredRes = await fetch(`${baseUrl}/api/incidents/inc-20261110-001/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        sig: 'hmac123',
        exp: Math.floor(Date.now() / 1000) - 3600
      })
    });
    expect(expiredRes.status).toBe(400);
    const expiredBody = (await expiredRes.json()) as { error: string };
    expect(expiredBody.error).toContain('expired');
  });

  it('should accept valid POST /api/incidents/:id/decision via signed HMAC parameters', async () => {
    const validExp = Math.floor(Date.now() / 1000) + 3600;
    const res = await fetch(`${baseUrl}/api/incidents/inc-20261110-001/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        sig: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        exp: validExp
      })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; action: string; source: string };
    expect(body.status).toBe('recorded');
    expect(body.action).toBe('approve');
    expect(body.source).toBe('email_hmac');
  });

  it('should reject decision with 404 for unknown incidentId', async () => {
    const validExp = Math.floor(Date.now() / 1000) + 3600;
    const res = await fetch(`${baseUrl}/api/incidents/unknown-incident-999/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        sig: 'sig123',
        exp: validExp
      })
    });
    expect(res.status).toBe(404);
  });

  it('should reject decision with 400 for invalid action', async () => {
    const validExp = Math.floor(Date.now() / 1000) + 3600;
    const res = await fetch(`${baseUrl}/api/incidents/inc-20261110-001/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'invalid_action',
        sig: 'sig123',
        exp: validExp
      })
    });
    expect(res.status).toBe(400);
  });

  it('should reject request with 400 on malformed JSON payload', async () => {
    const res = await fetch(`${baseUrl}/api/demo/chaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ malformed json'
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid JSON payload');
  });

  it('should stream events over GET /api/events (SSE)', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    if (reader) {
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event:');
      await reader.cancel();
    }
  });
});
