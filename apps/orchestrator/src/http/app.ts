import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router
} from 'express';
import { isEmpty } from '@zeromttr/utils';
import { CONTENT_TYPE, HTTP_STATUS } from '@zeromttr/utils/http';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { TargetStatusPort } from '../ports/target-status.port.js';
import type { HandleAlert } from '../application/handle-alert.js';
import type { OrchestratorWorkflow } from '../application/orchestrator-workflow.js';
import type { RecordDecision } from '../application/record-decision.js';
import { createInitialIncident } from '../application/create-initial-incident.js';
import { createGrafanaAuthMiddleware, createDashboardAuthMiddleware } from './auth.js';
import { registerApiRateLimits } from './rate-limit.js';
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
  settingsRouter?: Router | PluggableRouterFactory;
  enableRateLimiting?: boolean;
}

interface ResolvedAppAuthTokens {
  grafanaToken: string;
  dashboardToken: string;
}

function registerJsonBodyParser(app: Express): void {
  app.use(express.json({ limit: '1mb' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Malformed JSON request body' });
      return;
    }
    next(err);
  });
}

function resolveAppAuthTokens(
  dependencies: Pick<AppDependencies, 'grafanaWebhookToken' | 'dashboardApiToken'>,
  isTest: boolean
): ResolvedAppAuthTokens {
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

  return { grafanaToken, dashboardToken };
}

function registerPublicRoutes(app: Express): void {
  const initialIncident = createInitialIncident();

  app.get('/health', (_req, res) => {
    res.status(HTTP_STATUS.OK).json({
      status: HttpResponseStatus.OK,
      incident: initialIncident,
      uptime: process.uptime()
    });
  });

  app.get('/', (_req, res) => {
    res.status(HTTP_STATUS.OK).type(CONTENT_TYPE.TEXT_PLAIN).send('ZeroMTTR Orchestrator Running');
  });
}

function mountPluggableRouter(
  app: Express,
  basePath: string,
  pluggable: Router | PluggableRouterFactory | undefined,
  dashboardAuthMiddleware: RequestHandler
): void {
  if (!pluggable) {
    return;
  }
  const router = 'create' in pluggable ? pluggable.create({ dashboardAuthMiddleware }) : pluggable;
  app.use(basePath, router);
}

/**
 * Builds the Express application by composing JSON parsing, auth, rate limits, public routes, and API routers.
 */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const isTest = process.env.NODE_ENV === 'test';

  registerJsonBodyParser(app);

  const { grafanaToken, dashboardToken } = resolveAppAuthTokens(dependencies, isTest);
  const grafanaAuth = createGrafanaAuthMiddleware(grafanaToken, dashboardToken);
  const dashboardAuth = createDashboardAuthMiddleware(dashboardToken);
  const broadcaster = dependencies.broadcaster || new SseEventBroadcaster();

  if (dependencies.enableRateLimiting ?? !isTest) {
    registerApiRateLimits(app);
  }

  registerPublicRoutes(app);

  app.use(
    '/webhook',
    createWebhookRouter(dependencies.handleAlert, dependencies.orchestratorWorkflow, grafanaAuth)
  );
  app.use('/api', createDecisionRouter(dependencies.recordDecision));
  app.use(
    '/api',
    createApiRouter(
      dependencies.repository,
      dependencies.targetStatusPort,
      broadcaster,
      dashboardAuth
    )
  );

  mountPluggableRouter(app, '/api', dependencies.settingsRouter, dashboardAuth);
  mountPluggableRouter(app, '/api', dependencies.demoRouter, dashboardAuth);

  app.use((_req, res) => {
    res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Not Found' });
  });

  return app;
}
