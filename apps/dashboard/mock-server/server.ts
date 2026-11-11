import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isEmpty,
  isNonEmptyString,
  isNumber,
  safeJsonParse,
  toErrorMessage
} from '@zeromttr/utils';
import type {
  DecisionPayload,
  Incident,
  IncidentDetail,
  SimulateDecisionPayload,
  TargetStatusResponse
} from '../src/app/core/contract.js';
import { HEALTHY_TARGET_STATUS, INITIAL_TARGET_STATUS, MOCK_INCIDENT } from './mock-data.js';

export interface MockServerOptions {
  port?: number;
  heartbeatIntervalMs?: number;
}

class ClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

export class MockServer {
  private server: http.Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private currentIncident: IncidentDetail = JSON.parse(JSON.stringify(MOCK_INCIDENT));
  private targetStatus: TargetStatusResponse = { ...INITIAL_TARGET_STATUS };
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: MockServerOptions = {}) {}

  getIncident(): IncidentDetail {
    return this.currentIncident;
  }

  getTargetStatus(): TargetStatusResponse {
    return this.targetStatus;
  }

  setTargetStatus(status: TargetStatusResponse): void {
    this.targetStatus = status;
  }

  async start(): Promise<number> {
    const port = this.options.port ?? 0;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            const isClient =
              err instanceof ClientError || (err instanceof Error && err.name === 'ClientError');
            res.writeHead(isClient ? 400 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: toErrorMessage(err) }));
          } else {
            res.end();
          }
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(port, () => {
        const addr = this.server?.address();
        const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
        this.startHeartbeat();
        resolve(boundPort);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const interval = this.options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimer = setInterval(() => {
      this.broadcastSse('heartbeat', { at: new Date().toISOString() });
    }, interval);
  }

  broadcastSse(eventName: string, data: unknown): void {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      client.write(message);
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Live-Demo-Key');
  }

  private async parseBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (isEmpty(data)) {
          resolve({} as T);
          return;
        }
        const parsed = safeJsonParse<T>(data);
        if (parsed === null) {
          reject(new ClientError('Invalid JSON payload'));
          return;
        }
        resolve(parsed);
      });
      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // GET /api/events (SSE)
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();

      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });

      // Send initial events
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      res.write(
        `event: incident.created\ndata: ${JSON.stringify({
          incidentId: this.currentIncident.id,
          service: this.currentIncident.service,
          severity: this.currentIncident.severity,
          mode: this.currentIncident.mode,
          at: this.currentIncident.startedAt
        })}\n\n`
      );
      if (this.currentIncident.rca) {
        res.write(
          `event: incident.rca\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.rca
          })}\n\n`
        );
      }
      if (this.currentIncident.finops) {
        res.write(
          `event: incident.finops\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.finops
          })}\n\n`
        );
      }
      if (this.currentIncident.remediation) {
        res.write(
          `event: incident.remediation\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.remediation
          })}\n\n`
        );
      }
      if (this.currentIncident.notification) {
        res.write(
          `event: incident.notified\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            emailId: this.currentIncident.notification.emailId,
            htmlPreview: this.currentIncident.notification.htmlPreview
          })}\n\n`
        );
      }
      return;
    }

    // GET /api/incidents
    if (req.method === 'GET' && pathname === '/api/incidents') {
      const summary: Incident = {
        id: this.currentIncident.id,
        service: this.currentIncident.service,
        severity: this.currentIncident.severity,
        state: this.currentIncident.state,
        mode: this.currentIncident.mode,
        startedAt: this.currentIncident.startedAt
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([summary]));
      return;
    }

    // GET /api/incidents/:id
    if (req.method === 'GET' && pathname.startsWith('/api/incidents/')) {
      const id = pathname.replace('/api/incidents/', '');
      if (id !== this.currentIncident.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Incident ${id} not found` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.currentIncident));
      return;
    }

    // GET /api/target/status
    if (req.method === 'GET' && pathname === '/api/target/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.targetStatus));
      return;
    }

    // POST /api/demo/chaos
    if (req.method === 'POST' && pathname === '/api/demo/chaos') {
      const body = await this.parseBody<{ mode?: 'live' | 'replay' }>(req);
      const mode = isNonEmptyString(body.mode) && body.mode === 'live' ? 'live' : 'replay';

      this.targetStatus = { ...INITIAL_TARGET_STATUS };
      this.currentIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
      this.currentIncident.mode = mode;
      this.currentIncident.state = 'INVESTIGATING';

      this.broadcastSse('incident.created', {
        incidentId: this.currentIncident.id,
        service: this.currentIncident.service,
        severity: this.currentIncident.severity,
        mode,
        at: new Date().toISOString()
      });

      this.broadcastSse('incident.transition', {
        incidentId: this.currentIncident.id,
        from: 'RECEIVED',
        to: 'INVESTIGATING',
        at: new Date().toISOString(),
        reason: 'Chaos simulation triggered'
      });

      if (this.currentIncident.rca) {
        this.broadcastSse('incident.rca', {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.rca
        });
      }

      if (this.currentIncident.finops) {
        this.broadcastSse('incident.finops', {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.finops
        });
      }

      if (this.currentIncident.remediation) {
        this.broadcastSse('incident.remediation', {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.remediation
        });
      }

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'chaos_injected', mode }));
      return;
    }

    // POST /api/demo/reset
    if (req.method === 'POST' && pathname === '/api/demo/reset') {
      const previousState = this.currentIncident.state;
      this.targetStatus = { ...HEALTHY_TARGET_STATUS };
      this.currentIncident.state = 'RESOLVED';

      this.broadcastSse('incident.transition', {
        incidentId: this.currentIncident.id,
        from: previousState,
        to: 'RESOLVED',
        at: new Date().toISOString(),
        reason: 'Target service restored and chaos reset'
      });

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'reset_completed' }));
      return;
    }

    // POST /api/incidents/:id/decision
    if (req.method === 'POST' && pathname.includes('/decision') && !pathname.includes('simulate')) {
      const match = pathname.match(/^\/api\/incidents\/([^/]+)\/decision$/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid decision URL pattern' }));
        return;
      }
      const incidentId = match[1];
      if (incidentId !== this.currentIncident.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Incident not found: ${incidentId}` }));
        return;
      }

      const body = await this.parseBody<DecisionPayload>(req);

      if (!isNonEmptyString(body.action) || !isNonEmptyString(body.sig) || !isNumber(body.exp)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing decision parameters (action, sig, exp)' }));
        return;
      }

      if (body.action !== 'approve' && body.action !== 'reject') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid decision action: must be approve or reject' }));
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (body.exp < nowSeconds) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Decision link has expired' }));
        return;
      }

      this.currentIncident.decision = body.action;
      this.currentIncident.decisionSource = 'email_hmac';
      this.currentIncident.state = body.action === 'approve' ? 'RESOLVED' : 'REJECTED';

      this.broadcastSse('incident.decision', {
        incidentId,
        action: body.action,
        source: 'email_hmac'
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'recorded',
          incidentId,
          action: body.action,
          source: 'email_hmac'
        })
      );
      return;
    }

    // POST /api/demo/simulate-decision
    if (req.method === 'POST' && pathname === '/api/demo/simulate-decision') {
      const body = await this.parseBody<SimulateDecisionPayload>(req);

      if (!isNonEmptyString(body.incidentId) || !isNonEmptyString(body.action)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing incidentId or action' }));
        return;
      }

      if (body.incidentId !== this.currentIncident.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Incident not found: ${body.incidentId}` }));
        return;
      }

      if (body.action !== 'approve' && body.action !== 'reject') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid decision action: must be approve or reject' }));
        return;
      }

      this.currentIncident.decision = body.action;
      this.currentIncident.decisionSource = 'demo_simulation';
      this.currentIncident.state = body.action === 'approve' ? 'RESOLVED' : 'REJECTED';

      this.broadcastSse('incident.decision', {
        incidentId: body.incidentId,
        action: body.action,
        source: 'demo_simulation'
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'simulated',
          incidentId: body.incidentId,
          action: body.action,
          source: 'demo_simulation'
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${req.method} ${pathname}` }));
  }
}

export function createMockServer(options?: MockServerOptions): MockServer {
  return new MockServer(options);
}
