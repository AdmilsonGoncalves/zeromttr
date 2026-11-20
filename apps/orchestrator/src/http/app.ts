import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router
} from 'express';
import { isEmpty } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { TargetStatusPort } from '../ports/target-status.port.js';
import type { HandleAlert } from '../application/handle-alert.js';
import type { OrchestratorWorkflow } from '../application/orchestrator-workflow.js';
import type { RecordDecision } from '../application/record-decision.js';
import { createInitialIncident } from '../application/create-initial-incident.js';
import { createGrafanaAuthMiddleware, createDashboardAuthMiddleware } from './auth.js';
import { SseEventBroadcaster } from './events.sse.js';
import { createWebhookRouter } from './webhook.controller.js';
import { createApiRouter } from './api.controller.js';
import { createDecisionRouter } from './decision.controller.js';
import { HttpResponseStatus } from './http-constants.js';

export interface PluggableRouterFactory {
  create(context: { dashboardAuthMiddleware: RequestHandler }): Router;
}

export interface AppDependencies {
  repository: IncidentRepository;
  targetStatusPort: TargetStatusPort;
  handleAlert: HandleAlert;
  orchestratorWorkflow: OrchestratorWorkflow;
  recordDecision: RecordDecision;
  broadcaster?: SseEventBroadcaster;
  grafanaWebhookToken?: string;
  dashboardApiToken?: string;
  demoRouter?: Router | PluggableRouterFactory;
}

/**
 * Builds the Express application with health endpoints, webhook, decision, API, and demo routers.
 */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Malformed JSON request body' });
      return;
    }
    next(err);
  });

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
    if (isEmpty(grafanaToken)) {
      throw new Error('FATAL: GRAFANA_WEBHOOK_TOKEN must be configured.');
    }
    if (isEmpty(dashboardToken)) {
      throw new Error('FATAL: DASHBOARD_API_TOKEN must be configured.');
    }
  }

  const broadcaster = dependencies.broadcaster || new SseEventBroadcaster();

  const grafanaAuth = createGrafanaAuthMiddleware(grafanaToken, dashboardToken);
  const dashboardAuth = createDashboardAuthMiddleware(dashboardToken);

  const initialIncident = createInitialIncident();

  // Health check endpoint (public)
  app.get('/health', (_req, res) => {
    res.status(HTTP_STATUS.OK).json({
      status: HttpResponseStatus.OK,
      incident: initialIncident,
      uptime: process.uptime()
    });
  });

  // Root endpoint (public)
  app.get('/', (_req, res) => {
    res.status(HTTP_STATUS.OK).type('text/plain').send('ZeroMTTR Orchestrator Running');
  });

  // Webhook Router
  const webhookRouter = createWebhookRouter(
    dependencies.handleAlert,
    dependencies.orchestratorWorkflow,
    grafanaAuth
  );
  app.use('/webhook', webhookRouter);

  // Decision Router (mounted under /api)
  const decisionRouter = createDecisionRouter(dependencies.recordDecision);
  app.use('/api', decisionRouter);

  // Core Operational API Router (mounted under /api)
  const apiRouter = createApiRouter(
    dependencies.repository,
    dependencies.targetStatusPort,
    broadcaster,
    dashboardAuth
  );
  app.use('/api', apiRouter);

  // Optional Pluggable Demo Router (dependency inversion: core does not depend on demo)
  if (dependencies.demoRouter) {
    const resolvedDemoRouter =
      'create' in dependencies.demoRouter
        ? dependencies.demoRouter.create({ dashboardAuthMiddleware: dashboardAuth })
        : dependencies.demoRouter;
    app.use('/api', resolvedDemoRouter);
  }

  // 404 handler for unknown routes
  app.use((_req, res) => {
    res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Not Found' });
  });

  return app;
}
