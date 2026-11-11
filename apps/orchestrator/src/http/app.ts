import express, { type Express } from 'express';
import type { IncidentRepository, TargetStatusPort } from '../ports/index.js';
import {
  type HandleAlert,
  type OrchestratorWorkflow,
  type RecordDecision,
  createInitialIncident
} from '../application/index.js';
import {
  createGrafanaAuthMiddleware,
  createDashboardAuthMiddleware,
  createLiveDemoKeyMiddleware
} from './auth.js';
import { SseEventBroadcaster } from './events.sse.js';
import { createWebhookRouter } from './webhook.controller.js';
import { createApiRouter } from './api.controller.js';
import { createDecisionRouter } from './decision.controller.js';

export interface AppDependencies {
  repository: IncidentRepository;
  targetStatusPort: TargetStatusPort;
  handleAlert: HandleAlert;
  orchestratorWorkflow: OrchestratorWorkflow;
  recordDecision: RecordDecision;
  broadcaster?: SseEventBroadcaster;
  grafanaWebhookToken?: string;
  dashboardApiToken?: string;
  liveDemoKey?: string;
  demoCooldownMs?: number;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  const isTest = process.env.NODE_ENV === 'test';
  const grafanaToken =
    dependencies.grafanaWebhookToken ||
    process.env.GRAFANA_WEBHOOK_TOKEN ||
    (isTest ? 'test-grafana-token' : '');
  const dashboardToken =
    dependencies.dashboardApiToken ||
    process.env.DASHBOARD_API_TOKEN ||
    (isTest ? 'test-dashboard-token' : '');

  if (!isTest) {
    if (!grafanaToken) {
      throw new Error('FATAL: GRAFANA_WEBHOOK_TOKEN must be configured.');
    }
    if (!dashboardToken) {
      throw new Error('FATAL: DASHBOARD_API_TOKEN must be configured.');
    }
  }

  const liveDemoKey = dependencies.liveDemoKey ?? process.env.LIVE_DEMO_KEY;
  const demoCooldownMs =
    dependencies.demoCooldownMs ?? (Number(process.env.DEMO_COOLDOWN_MS) || 120_000);

  const broadcaster = dependencies.broadcaster || new SseEventBroadcaster();

  const grafanaAuth = createGrafanaAuthMiddleware(grafanaToken, dashboardToken);
  const dashboardAuth = createDashboardAuthMiddleware(dashboardToken);
  const liveDemoAuth = createLiveDemoKeyMiddleware(liveDemoKey);

  const initialIncident = createInitialIncident();

  // Health check endpoint (public)
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      incident: initialIncident,
      uptime: process.uptime()
    });
  });

  // Root endpoint (public)
  app.get('/', (_req, res) => {
    res.status(200).type('text/plain').send('ZeroMTTR Orchestrator Running');
  });

  // Webhook Router
  const webhookRouter = createWebhookRouter(
    dependencies.handleAlert,
    dependencies.orchestratorWorkflow,
    grafanaAuth
  );
  app.use('/webhook', webhookRouter);

  // Decision Router (mounted under /api)
  const decisionRouter = createDecisionRouter(
    dependencies.recordDecision,
    dashboardAuth,
    liveDemoAuth
  );
  app.use('/api', decisionRouter);

  // API Router (mounted under /api)
  const apiRouter = createApiRouter(
    dependencies.repository,
    dependencies.targetStatusPort,
    broadcaster,
    dashboardAuth,
    liveDemoAuth,
    demoCooldownMs
  );
  app.use('/api', apiRouter);

  // 404 handler for unknown routes
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
