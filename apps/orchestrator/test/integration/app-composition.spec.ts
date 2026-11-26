import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTP_HEADERS, HTTP_STATUS } from '@zeromttr/utils/http';
import { FileIncidentRepository } from '../../src/adapters/repo.file.js';
import type { HandleAlert } from '../../src/application/handle-alert.js';
import type { OrchestratorWorkflow } from '../../src/application/orchestrator-workflow.js';
import type { RecordDecision } from '../../src/application/record-decision.js';
import { createApp } from '../../src/http/app.js';
import { registerApiRateLimits } from '../../src/http/rate-limit.js';
import { bootstrap } from '../../src/main.js';
import type { TargetStatusPort } from '../../src/ports/target-status.port.js';

function createMinimalAppDependencies() {
  return {
    repository: new FileIncidentRepository(),
    targetStatusPort: {
      getStatus: vi.fn()
    } as unknown as TargetStatusPort,
    handleAlert: { execute: vi.fn() } as unknown as HandleAlert,
    orchestratorWorkflow: { runFullPipeline: vi.fn() } as unknown as OrchestratorWorkflow,
    recordDecision: { execute: vi.fn() } as unknown as RecordDecision
  };
}

describe('createApp composition and rate-limit wiring', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalGrafanaToken = process.env.GRAFANA_WEBHOOK_TOKEN;
  const originalDashboardToken = process.env.DASHBOARD_API_TOKEN;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalGrafanaToken === undefined) {
      delete process.env.GRAFANA_WEBHOOK_TOKEN;
    } else {
      process.env.GRAFANA_WEBHOOK_TOKEN = originalGrafanaToken;
    }
    if (originalDashboardToken === undefined) {
      delete process.env.DASHBOARD_API_TOKEN;
    } else {
      process.env.DASHBOARD_API_TOKEN = originalDashboardToken;
    }
  });

  it('should_register_read_and_strict_write_rate_limits_on_API_routes_including_settings', async () => {
    const app = express();
    registerApiRateLimits(app);
    app.get('/api/settings', (_req, res) => {
      res.status(HTTP_STATUS.OK).json({ ok: true });
    });
    app.patch('/api/settings', (_req, res) => {
      res.status(HTTP_STATUS.OK).json({ ok: true });
    });

    const getRes = await request(app).get('/api/settings');
    expect(getRes.status).toBe(HTTP_STATUS.OK);
    expect(getRes.headers['ratelimit-limit']).toBe('600');

    const patchRes = await request(app).patch('/api/settings');
    expect(patchRes.status).toBe(HTTP_STATUS.OK);
    expect(patchRes.headers['ratelimit-limit']).toBe('30');
  });

  it('should_return_400_JSON_when_receiving_a_malformed_JSON_request_body', async () => {
    const app = createApp(createMinimalAppDependencies());

    const res = await request(app)
      .post('/webhook/grafana-alert')
      .set(HTTP_HEADERS.CONTENT_TYPE, 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.body).toEqual({ error: 'Malformed JSON request body' });
  });

  it('should_mount_both_Router_instances_and_PluggableRouterFactory_objects_cleanly', async () => {
    const directDemoRouter = Router();
    directDemoRouter.get('/demo/ping', (_req, res) => {
      res.status(HTTP_STATUS.OK).json({ source: 'direct-router' });
    });

    const settingsFactory = {
      create: () => {
        const router = Router();
        router.get('/settings/ping', (_req, res) => {
          res.status(HTTP_STATUS.OK).json({ source: 'factory-router' });
        });
        return router;
      }
    };

    const app = createApp({
      ...createMinimalAppDependencies(),
      dashboardApiToken: 'test-dashboard-token',
      demoRouter: directDemoRouter,
      settingsRouter: settingsFactory
    });

    const demoRes = await request(app)
      .get('/api/demo/ping')
      .set(HTTP_HEADERS.AUTHORIZATION, 'Bearer test-dashboard-token');
    expect(demoRes.status).toBe(HTTP_STATUS.OK);
    expect(demoRes.body).toEqual({ source: 'direct-router' });

    const settingsRes = await request(app)
      .get('/api/settings/ping')
      .set(HTTP_HEADERS.AUTHORIZATION, 'Bearer test-dashboard-token');
    expect(settingsRes.status).toBe(HTTP_STATUS.OK);
    expect(settingsRes.body).toEqual({ source: 'factory-router' });
  });

  it('should_fail_closed_outside_test_environment_when_auth_tokens_are_missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GRAFANA_WEBHOOK_TOKEN;
    delete process.env.DASHBOARD_API_TOKEN;

    expect(() => createApp(createMinimalAppDependencies())).toThrow(
      /FATAL: GRAFANA_WEBHOOK_TOKEN must be configured/
    );

    expect(() =>
      createApp({
        ...createMinimalAppDependencies(),
        grafanaWebhookToken: 'valid-grafana-token'
      })
    ).toThrow(/FATAL: DASHBOARD_API_TOKEN must be configured/);
  });

  it('should_validate_required_credentials_before_opening_SQLite_in_bootstrap', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeromttr-bootstrap-cred-'));
    const dbPath = path.join(tempDir, 'should-not-exist.sqlite');
    const prevDbPath = process.env.SETTINGS_DB_PATH;
    const prevHmac = process.env.DECISION_HMAC_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.SETTINGS_DB_PATH = dbPath;
    delete process.env.DECISION_HMAC_SECRET;

    try {
      expect(() => bootstrap(0)).toThrow(/FATAL: DECISION_HMAC_SECRET must be configured/);
      expect(fs.existsSync(dbPath)).toBe(false);

      process.env.DECISION_HMAC_SECRET = '   ';
      expect(() => bootstrap(0)).toThrow(/FATAL: DECISION_HMAC_SECRET must be configured/);
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      if (prevDbPath === undefined) {
        delete process.env.SETTINGS_DB_PATH;
      } else {
        process.env.SETTINGS_DB_PATH = prevDbPath;
      }
      if (prevHmac === undefined) {
        delete process.env.DECISION_HMAC_SECRET;
      } else {
        process.env.DECISION_HMAC_SECRET = prevHmac;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should_end_open_SSE_streams_when_server_close_is_called_without_deadlocking', async () => {
    process.env.DASHBOARD_API_TOKEN = 'test-sse-shutdown-token';
    const server = bootstrap(0);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      await new Promise<void>((resolve) => {
        if (server.listening) {
          resolve();
          return;
        }
        server.once('listening', () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP address');
      }

      const res = await fetch(
        `http://127.0.0.1:${address.port}/api/events?token=test-sse-shutdown-token`
      );
      expect(res.status).toBe(HTTP_STATUS.OK);
      reader = res.body?.getReader();
      expect(reader).toBeDefined();
      // Consume initial heartbeat and confirm a second read remains pending while SSE stays open
      await reader!.read();
      const pendingRead = reader!.read();
      const stayedOpen = await Promise.race([
        pendingRead.then(() => false),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), 60);
        })
      ]);
      expect(stayedOpen).toBe(true);

      const closedWithinTimeout = await Promise.race([
        Promise.all([
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
          pendingRead.then((chunk) => {
            expect(chunk.done).toBe(true);
          })
        ]).then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 1500);
        })
      ]);

      expect(closedWithinTimeout).toBe(true);
    } finally {
      try {
        await reader?.cancel();
      } catch {
        // Stream already ended by server shutdown
      }
      if (server.listening) {
        server.close();
      }
    }
  });
});
