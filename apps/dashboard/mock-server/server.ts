import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SystemSettingsPatchSchema } from '@zeromttr/contracts';
import {
  isEmpty,
  isNonEmptyString,
  isNumber,
  isObject,
  nowIso,
  safeJsonParse,
  toErrorMessage
} from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import {
  DecisionAction,
  DecisionSource,
  IncidentEventType,
  IncidentExecutionMode,
  IncidentState,
  SettingsPersistenceEngine,
  SystemLogLevel,
  type DecisionPayload,
  type Incident,
  type IncidentDetail,
  type IncidentMode,
  type SettingsAuditEntry,
  type SimulateDecisionPayload,
  type SystemSettings,
  type SystemSettingsPatch,
  type TargetStatusResponse
} from '../src/app/core/contract.js';
import { HEALTHY_TARGET_STATUS, INITIAL_TARGET_STATUS, MOCK_INCIDENT } from './mock-data.js';

export interface MockServerOptions {
  port?: number;
  heartbeatIntervalMs?: number;
}

function maskEmailForDisplay(email: string): string {
  const trimmed = email.trim();
  if (!isNonEmptyString(trimmed)) {
    return '';
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const visiblePrefix = local.slice(0, Math.min(2, Math.max(0, local.length - 1)));
  return `${visiblePrefix}***${domain}`;
}

function formatMockAuditValue(
  key: keyof SystemSettings,
  value: SystemSettings[keyof SystemSettings]
): string {
  if (key === 'onCallEmail') {
    return maskEmailForDisplay(String(value));
  }
  return String(value);
}

class ClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

/**
 * Standalone HTTP and SSE mock server simulating orchestrator endpoints for local dashboard development.
 */
export class MockServer {
  private server: http.Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private currentIncident: IncidentDetail = structuredClone(MOCK_INCIDENT);
  private targetStatus: TargetStatusResponse = { ...INITIAL_TARGET_STATUS };
  private systemSettings: SystemSettings = {
    rejectionCooldownSeconds: 900,
    repeatSuppressionSeconds: 60,
    decisionTtlSeconds: 900,
    autoRestoreOnApprove: true,
    targetServicePath: 'apps/target-app-demo',
    targetBaseRef: 'v2.14.7',
    targetHeadRef: 'v2.14.8',
    targetErrorRateThresholdPercent: 5,
    llmModel: 'gemini-3.5-flash',
    llmFallbackModel: 'gemini-3.5-flash-lite',
    onCallEmail: 'oncall-sre@example.com',
    logLevel: SystemLogLevel.INFO
  };
  private settingsAuditLog: SettingsAuditEntry[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: MockServerOptions = {}) {}

  private sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON });
    res.end(JSON.stringify(body));
  }

  /**
   * Returns the current in-memory incident detail state.
   */
  getIncident(): IncidentDetail {
    return this.currentIncident;
  }

  /**
   * Returns the current simulated target service status.
   */
  getTargetStatus(): TargetStatusResponse {
    return this.targetStatus;
  }

  /**
   * Overrides the simulated target service status.
   */
  setTargetStatus(status: TargetStatusResponse): void {
    this.targetStatus = status;
  }

  /**
   * Starts the HTTP and SSE mock server and returns the bound port.
   */
  async start(): Promise<number> {
    const port = this.options.port ?? 0;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            const isClient =
              err instanceof ClientError || (err instanceof Error && err.name === 'ClientError');
            this.sendJson(
              res,
              isClient ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.INTERNAL_SERVER_ERROR,
              { error: toErrorMessage(err) }
            );
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
        const boundPort = isObject(addr) && isNumber(addr.port) ? addr.port : port;
        this.startHeartbeat();
        resolve(boundPort);
      });
    });
  }

  /**
   * Stops the heartbeat timer, closes active SSE streams, and shuts down the HTTP server.
   */
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
      this.broadcastSse(IncidentEventType.HEARTBEAT, { at: nowIso() });
    }, interval);
  }

  /**
   * Sends a named SSE event payload to all connected dashboard clients.
   */
  broadcastSse(eventName: string, data: unknown): void {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      client.write(message);
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      `${HTTP_HEADERS.CONTENT_TYPE}, ${HTTP_HEADERS.AUTHORIZATION}, ${HTTP_HEADERS.LIVE_DEMO_KEY}, ${HTTP_HEADERS.SETTINGS_ADMIN_TOKEN}`
    );
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
      res.writeHead(HTTP_STATUS.NO_CONTENT);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // GET /api/events (SSE)
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(HTTP_STATUS.OK, {
        [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.EVENT_STREAM,
        [HTTP_HEADERS.CACHE_CONTROL]: 'no-cache, no-transform',
        [HTTP_HEADERS.CONNECTION]: 'keep-alive',
        [HTTP_HEADERS.X_ACCEL_BUFFERING]: 'no'
      });
      res.flushHeaders?.();

      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });

      // Send initial events
      res.write(
        `event: ${IncidentEventType.HEARTBEAT}\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`
      );
      res.write(
        `event: ${IncidentEventType.CREATED}\ndata: ${JSON.stringify({
          incidentId: this.currentIncident.id,
          service: this.currentIncident.service,
          severity: this.currentIncident.severity,
          mode: this.currentIncident.mode,
          at: this.currentIncident.startedAt
        })}\n\n`
      );
      if (this.currentIncident.rca) {
        res.write(
          `event: ${IncidentEventType.RCA}\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.rca
          })}\n\n`
        );
      }
      if (this.currentIncident.finops) {
        res.write(
          `event: ${IncidentEventType.FINOPS}\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.finops
          })}\n\n`
        );
      }
      if (this.currentIncident.remediation) {
        res.write(
          `event: ${IncidentEventType.REMEDIATION}\ndata: ${JSON.stringify({
            incidentId: this.currentIncident.id,
            ...this.currentIncident.remediation
          })}\n\n`
        );
      }
      if (this.currentIncident.notification) {
        res.write(
          `event: ${IncidentEventType.NOTIFIED}\ndata: ${JSON.stringify({
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
      this.sendJson(res, HTTP_STATUS.OK, [summary]);
      return;
    }

    // GET /api/incidents/:id
    if (req.method === 'GET' && pathname.startsWith('/api/incidents/')) {
      const id = pathname.replace('/api/incidents/', '');
      if (id !== this.currentIncident.id) {
        this.sendJson(res, HTTP_STATUS.NOT_FOUND, { error: `Incident ${id} not found` });
        return;
      }
      this.sendJson(res, HTTP_STATUS.OK, this.currentIncident);
      return;
    }

    // GET /api/target/status
    if (req.method === 'GET' && pathname === '/api/target/status') {
      this.sendJson(res, HTTP_STATUS.OK, this.targetStatus);
      return;
    }

    // GET /api/demo/config
    if (req.method === 'GET' && pathname === '/api/demo/config') {
      this.sendJson(res, HTTP_STATUS.OK, {
        demoModeEnabled: true,
        requireDemoKey: false,
        publicLiveDemo: true,
        turnstileSiteKey: null,
        turnstileRequired: false
      });
      return;
    }

    // GET /api/settings
    if (req.method === 'GET' && pathname === '/api/settings') {
      this.sendJson(res, HTTP_STATUS.OK, {
        settings: {
          ...this.systemSettings,
          onCallEmail: maskEmailForDisplay(this.systemSettings.onCallEmail)
        },
        readonlyInfo: {
          targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
          targetBaseBranch: 'release/target-v2.14.8',
          targetStatusProvider: 'manifest',
          grafanaRepeatInterval: '1m',
          persistenceEngine: SettingsPersistenceEngine.SQLITE
        },
        editable: true,
        requiresAuthKey: false,
        auditLog: this.settingsAuditLog.slice(0, 25)
      });
      return;
    }

    // PATCH /api/settings
    if (req.method === 'PATCH' && pathname === '/api/settings') {
      const rawPatch = await this.parseBody<unknown>(req);
      const parsed = SystemSettingsPatchSchema.safeParse(rawPatch);
      if (!parsed.success) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, {
          error: 'Invalid system settings payload',
          details: parsed.error.format()
        });
        return;
      }

      const patch: SystemSettingsPatch = parsed.data;
      const changedAt = nowIso();
      for (const key of Object.keys(patch) as Array<keyof SystemSettings>) {
        const nextVal = patch[key];
        if (nextVal !== undefined && this.systemSettings[key] !== nextVal) {
          const oldVal = this.systemSettings[key];
          (this.systemSettings as Record<string, unknown>)[key] = nextVal;
          this.settingsAuditLog.unshift({
            id: this.settingsAuditLog.length + 1,
            settingKey: key,
            oldValue: formatMockAuditValue(key, oldVal),
            newValue: formatMockAuditValue(key, nextVal),
            actor: 'dashboard_operator',
            changedAt
          });
        }
      }
      this.sendJson(res, HTTP_STATUS.OK, {
        settings: {
          ...this.systemSettings,
          onCallEmail: maskEmailForDisplay(this.systemSettings.onCallEmail)
        },
        readonlyInfo: {
          targetGithubRepo: 'https://github.com/AdmilsonGoncalves/zeromttr',
          targetBaseBranch: 'release/target-v2.14.8',
          targetStatusProvider: 'manifest',
          grafanaRepeatInterval: '1m',
          persistenceEngine: SettingsPersistenceEngine.SQLITE
        },
        editable: true,
        requiresAuthKey: false,
        auditLog: this.settingsAuditLog.slice(0, 25)
      });
      return;
    }

    // POST /api/demo/chaos
    if (req.method === 'POST' && pathname === '/api/demo/chaos') {
      const body = await this.parseBody<{ mode?: IncidentMode }>(req);
      const mode: IncidentMode =
        isNonEmptyString(body.mode) && body.mode === IncidentExecutionMode.LIVE
          ? IncidentExecutionMode.LIVE
          : IncidentExecutionMode.REPLAY;

      this.targetStatus = { ...INITIAL_TARGET_STATUS };
      this.currentIncident = structuredClone(MOCK_INCIDENT);
      this.currentIncident.mode = mode;
      this.currentIncident.state = IncidentState.INVESTIGATING;

      this.broadcastSse(IncidentEventType.CREATED, {
        incidentId: this.currentIncident.id,
        service: this.currentIncident.service,
        severity: this.currentIncident.severity,
        mode,
        at: nowIso()
      });

      this.broadcastSse(IncidentEventType.TRANSITION, {
        incidentId: this.currentIncident.id,
        from: IncidentState.RECEIVED,
        to: IncidentState.INVESTIGATING,
        at: nowIso(),
        reason: 'Chaos simulation triggered'
      });

      if (this.currentIncident.rca) {
        this.broadcastSse(IncidentEventType.RCA, {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.rca
        });
      }

      if (this.currentIncident.finops) {
        this.broadcastSse(IncidentEventType.FINOPS, {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.finops
        });
      }

      if (this.currentIncident.remediation) {
        this.broadcastSse(IncidentEventType.REMEDIATION, {
          incidentId: this.currentIncident.id,
          ...this.currentIncident.remediation
        });
      }

      this.sendJson(res, HTTP_STATUS.ACCEPTED, { status: 'chaos_injected', mode });
      return;
    }

    // POST /api/demo/reset
    if (req.method === 'POST' && pathname === '/api/demo/reset') {
      const previousState = this.currentIncident.state;
      this.targetStatus = { ...HEALTHY_TARGET_STATUS };
      this.currentIncident.state = IncidentState.RESOLVED;

      this.broadcastSse(IncidentEventType.TRANSITION, {
        incidentId: this.currentIncident.id,
        from: previousState,
        to: IncidentState.RESOLVED,
        at: nowIso(),
        reason: 'Target service restored and chaos reset'
      });

      this.sendJson(res, HTTP_STATUS.ACCEPTED, { status: 'reset_completed' });
      return;
    }

    // POST /api/incidents/:id/decision
    if (req.method === 'POST' && pathname.includes('/decision') && !pathname.includes('simulate')) {
      const match = pathname.match(/^\/api\/incidents\/([^/]+)\/decision$/);
      if (!match) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, { error: 'Invalid decision URL pattern' });
        return;
      }
      const incidentId = match[1];
      if (incidentId !== this.currentIncident.id) {
        this.sendJson(res, HTTP_STATUS.NOT_FOUND, { error: `Incident not found: ${incidentId}` });
        return;
      }

      const body = await this.parseBody<DecisionPayload>(req);

      if (!isNonEmptyString(body.action) || !isNonEmptyString(body.sig) || !isNumber(body.exp)) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, {
          error: 'Missing decision parameters (action, sig, exp)'
        });
        return;
      }

      if (body.action !== DecisionAction.APPROVE && body.action !== DecisionAction.REJECT) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, {
          error: 'Invalid decision action: must be approve or reject'
        });
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (body.exp < nowSeconds) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, { error: 'Decision link has expired' });
        return;
      }

      this.currentIncident.decision = body.action;
      this.currentIncident.decisionSource = DecisionSource.EMAIL_HMAC;
      this.currentIncident.state =
        body.action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED;

      this.broadcastSse(IncidentEventType.DECISION, {
        incidentId,
        action: body.action,
        source: DecisionSource.EMAIL_HMAC
      });

      this.sendJson(res, HTTP_STATUS.OK, {
        status: 'recorded',
        incidentId,
        action: body.action,
        source: DecisionSource.EMAIL_HMAC
      });
      return;
    }

    // POST /api/demo/simulate-decision
    if (req.method === 'POST' && pathname === '/api/demo/simulate-decision') {
      const body = await this.parseBody<SimulateDecisionPayload>(req);

      if (!isNonEmptyString(body.incidentId) || !isNonEmptyString(body.action)) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, { error: 'Missing incidentId or action' });
        return;
      }

      if (body.incidentId !== this.currentIncident.id) {
        this.sendJson(res, HTTP_STATUS.NOT_FOUND, {
          error: `Incident not found: ${body.incidentId}`
        });
        return;
      }

      if (body.action !== DecisionAction.APPROVE && body.action !== DecisionAction.REJECT) {
        this.sendJson(res, HTTP_STATUS.BAD_REQUEST, {
          error: 'Invalid decision action: must be approve or reject'
        });
        return;
      }

      this.currentIncident.decision = body.action;
      this.currentIncident.decisionSource = DecisionSource.DEMO_SIMULATION;
      this.currentIncident.state =
        body.action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED;

      this.broadcastSse(IncidentEventType.DECISION, {
        incidentId: body.incidentId,
        action: body.action,
        source: DecisionSource.DEMO_SIMULATION
      });

      this.sendJson(res, HTTP_STATUS.OK, {
        status: 'simulated',
        incidentId: body.incidentId,
        action: body.action,
        source: DecisionSource.DEMO_SIMULATION
      });
      return;
    }

    this.sendJson(res, HTTP_STATUS.NOT_FOUND, { error: `Not found: ${req.method} ${pathname}` });
  }
}

/**
 * Creates a new dashboard mock server instance.
 */
export function createMockServer(options?: MockServerOptions): MockServer {
  return new MockServer(options);
}
