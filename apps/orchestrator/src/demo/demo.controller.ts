import {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  Router
} from 'express';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { TargetStatusPort } from '../ports/target-status.port.js';
import type { DemoControlPort } from './demo-control.port.js';
import { createDemoAccessGuards } from './demo-guards.js';
import {
  DemoChaosPayloadSchema,
  HealthyTrafficPayloadSchema,
  SimulateDecisionPayloadSchema,
  createDemoChaosHandler,
  createDemoConfigHandler,
  createDemoHealthyTrafficHandler,
  createDemoResetHandler,
  createDemoSimulateDecisionHandler
} from './demo-handlers.js';
import { type DemoSessionLifecycle, createDemoSessionLifecycle } from './demo-session-lifecycle.js';
import type { ReplayRunner } from './replay-runner.js';
import type { SimulateDemoDecision } from './simulate-demo-decision.js';

export {
  DemoChaosPayloadSchema,
  HealthyTrafficPayloadSchema,
  SimulateDecisionPayloadSchema,
  createDemoSessionLifecycle
};
export type { DemoSessionLifecycle };

export interface DemoRouterDependencies {
  demoControlPort: DemoControlPort;
  simulateDemoDecision: SimulateDemoDecision;
  replayRunner?: ReplayRunner;
  repository?: IncidentRepository;
  targetStatusPort?: TargetStatusPort;
  lifecycle?: DemoSessionLifecycle;
  dashboardAuthMiddleware?: RequestHandler;
  liveDemoKey?: string;
  publicLiveDemo?: boolean;
  requireDemoKey?: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  liveDemoMiddleware?: (req: Request, res: Response, next: NextFunction) => void;
  turnstileMiddleware?: RequestHandler;
  cooldownMs?: number;
}

export type DemoRouterContext = {
  dashboardAuthMiddleware: RequestHandler;
};

export interface DemoRouterFactory {
  create(context: DemoRouterContext): Router;
}

const DEFAULT_DEMO_COOLDOWN_MS = 120_000;

/**
 * Mounts interactive demo endpoints (`/demo/*`) with isolated guards, handlers, and serialized lifecycle.
 */
export function createDemoRouter(dependencies: DemoRouterDependencies): Router {
  const router = Router();
  const cooldownMs = dependencies.cooldownMs ?? DEFAULT_DEMO_COOLDOWN_MS;
  const lifecycle =
    dependencies.lifecycle ??
    createDemoSessionLifecycle(
      dependencies.demoControlPort,
      dependencies.replayRunner,
      dependencies.targetStatusPort
    );
  const guards = createDemoAccessGuards(dependencies);

  router.get('/demo/config', ...guards.dashboardMiddlewares, createDemoConfigHandler(guards));
  router.post(
    '/demo/chaos',
    ...guards.dashboardMiddlewares,
    guards.turnstileMiddleware,
    createDemoChaosHandler({
      guards,
      lifecycle,
      demoControlPort: dependencies.demoControlPort,
      replayRunner: dependencies.replayRunner,
      cooldownMs
    })
  );
  router.post(
    '/demo/reset',
    ...guards.dashboardMiddlewares,
    guards.turnstileMiddleware,
    createDemoResetHandler({
      guards,
      lifecycle,
      demoControlPort: dependencies.demoControlPort,
      replayRunner: dependencies.replayRunner,
      repository: dependencies.repository
    })
  );
  router.post(
    '/demo/simulate-decision',
    ...guards.dashboardMiddlewares,
    guards.turnstileMiddleware,
    createDemoSimulateDecisionHandler({
      guards,
      lifecycle,
      repository: dependencies.repository,
      simulateDemoDecision: dependencies.simulateDemoDecision
    })
  );
  router.post(
    '/demo/healthy-traffic',
    ...guards.dashboardMiddlewares,
    guards.turnstileMiddleware,
    createDemoHealthyTrafficHandler({
      guards,
      demoControlPort: dependencies.demoControlPort
    })
  );

  return router;
}

/**
 * Wraps `createDemoRouter` into a pluggable factory wired after dashboard middleware initialization.
 */
export function createDemoRouterFactory(
  dependencies: Omit<DemoRouterDependencies, 'dashboardAuthMiddleware'>
): DemoRouterFactory {
  return {
    create: ({ dashboardAuthMiddleware }) =>
      createDemoRouter({
        ...dependencies,
        dashboardAuthMiddleware
      })
  };
}
