import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response
} from 'express';
import { z } from 'zod';
import { toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import {
  IncidentAlreadyResolvedError,
  IncidentNotFoundError
} from '../application/decision-helpers.js';
import { DecisionAction, IncidentExecutionMode } from '../domain/incident-enums.js';
import type { IncidentMode } from '../domain/incident.js';
import { IncidentState } from '../domain/incident-state.js';
import { createLiveDemoKeyMiddleware } from '../http/auth.js';
import { HttpResponseStatus } from '../http/http-constants.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { DemoControlPort } from './demo-control.port.js';
import type { ReplayRunner } from './replay-runner.js';
import type { SimulateDemoDecision } from './simulate-demo-decision.js';

export const DemoChaosPayloadSchema = z
  .object({
    mode: z
      .enum([IncidentExecutionMode.LIVE, IncidentExecutionMode.REPLAY])
      .optional()
      .default(IncidentExecutionMode.REPLAY)
  })
  .optional()
  .default({ mode: IncidentExecutionMode.REPLAY });

export const SimulateDecisionPayloadSchema = z.object({
  incidentId: z.string().min(1),
  action: z.enum([DecisionAction.APPROVE, DecisionAction.REJECT])
});

export interface DemoRouterDependencies {
  demoControlPort: DemoControlPort;
  simulateDemoDecision: SimulateDemoDecision;
  replayRunner?: ReplayRunner;
  repository?: IncidentRepository;
  dashboardAuthMiddleware?: RequestHandler;
  liveDemoKey?: string;
  liveDemoMiddleware?: (req: Request, res: Response, next: NextFunction) => void;
  cooldownMs?: number;
}

export type DemoRouterContext = {
  dashboardAuthMiddleware: RequestHandler;
};

export interface DemoRouterFactory {
  create(context: DemoRouterContext): Router;
}

function runExpressMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (allowed: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(allowed);
      }
    };

    res.once('finish', () => finish(false));
    middleware(req, res, () => finish(true));

    if (res.writableEnded || res.headersSent) {
      finish(false);
    }
  });
}

/**
 * Mounts interactive demo endpoints (`/demo/chaos`, `/demo/reset`, `/demo/simulate-decision`) with cooldown and auth guards.
 */
export function createDemoRouter(dependencies: DemoRouterDependencies): Router {
  const router = Router();
  const cooldownMs = dependencies.cooldownMs ?? 120_000;
  let lastChaosTimestamp = 0;
  let lastChaosMode: IncidentMode = IncidentExecutionMode.REPLAY;

  const liveDemoAuth =
    dependencies.liveDemoMiddleware ?? createLiveDemoKeyMiddleware(dependencies.liveDemoKey);

  const authMiddlewares: RequestHandler[] = dependencies.dashboardAuthMiddleware
    ? [dependencies.dashboardAuthMiddleware]
    : [];

  // Trigger demo chaos (replay is public-demo accessible; live requires X-Live-Demo-Key when configured)
  router.post('/demo/chaos', ...authMiddlewares, (req: Request, res: Response): void => {
    void (async () => {
      const parsed = DemoChaosPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Invalid demo chaos payload',
          details: parsed.error.format()
        });
        return;
      }

      const mode: IncidentMode = parsed.data.mode;
      if (mode === IncidentExecutionMode.LIVE) {
        const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
        if (!allowed) {
          return;
        }
      }

      const now = Date.now();
      if (lastChaosTimestamp > 0 && now - lastChaosTimestamp < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - (now - lastChaosTimestamp)) / 1000);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          error: `Chaos simulation is in cooldown. Please wait ${remainingSeconds} seconds before triggering again.`,
          retryAfterSeconds: remainingSeconds
        });
        return;
      }

      const previousTimestamp = lastChaosTimestamp;
      const previousMode = lastChaosMode;
      lastChaosTimestamp = now;
      lastChaosMode = mode;

      try {
        let incidentId: string | undefined;
        if (mode === IncidentExecutionMode.LIVE) {
          dependencies.replayRunner?.stop();
          await dependencies.demoControlPort.triggerChaos(true);
        } else if (dependencies.replayRunner) {
          incidentId = await dependencies.replayRunner.trigger();
        }
        res.status(HTTP_STATUS.ACCEPTED).json({
          status: HttpResponseStatus.ACCEPTED,
          mode,
          ...(incidentId ? { incidentId } : {}),
          message: 'Chaos simulation initialized'
        });
      } catch (err) {
        lastChaosTimestamp = previousTimestamp;
        lastChaosMode = previousMode;
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to initialize chaos')
        });
      }
    })();
  });

  // Reset demo (requires X-Live-Demo-Key if active session was live)
  router.post('/demo/reset', ...authMiddlewares, (req: Request, res: Response): void => {
    void (async () => {
      if (lastChaosTimestamp > 0 && lastChaosMode === IncidentExecutionMode.LIVE) {
        const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
        if (!allowed) {
          return;
        }
      }

      try {
        lastChaosTimestamp = 0;
        lastChaosMode = IncidentExecutionMode.REPLAY;
        dependencies.replayRunner?.stop();
        if (dependencies.repository) {
          try {
            const incidents = await dependencies.repository.findAll();
            for (const inc of incidents) {
              if (
                inc.state !== IncidentState.RESOLVED &&
                inc.state !== IncidentState.REJECTED &&
                inc.state !== IncidentState.FAILED
              ) {
                inc.transition(IncidentState.FAILED, 'Demo reset by operator');
                await dependencies.repository.save(inc);
              }
            }
          } catch {
            // Non-fatal repository transition error during reset
          }
        }
        await dependencies.demoControlPort.reset();
        res.status(HTTP_STATUS.ACCEPTED).json({
          status: HttpResponseStatus.ACCEPTED,
          message: 'Service restored and demo state reset'
        });
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to reset demo')
        });
      }
    })();
  });

  // Interactive simulated decision (requires X-Live-Demo-Key when targeting a live incident)
  router.post(
    '/demo/simulate-decision',
    ...authMiddlewares,
    (req: Request, res: Response): void => {
      void (async () => {
        const parsed = SimulateDecisionPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: 'Invalid simulate decision payload',
            details: parsed.error.format()
          });
          return;
        }

        const { incidentId, action } = parsed.data;

        if (dependencies.repository) {
          const existing = await dependencies.repository.findById(incidentId);
          if (existing && existing.mode === IncidentExecutionMode.LIVE) {
            const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
            if (!allowed) {
              return;
            }
          }
        }

        try {
          const incident = await dependencies.simulateDemoDecision.execute(incidentId, action);
          res.status(HTTP_STATUS.OK).json({
            success: true,
            simulated: true,
            incidentId: incident.id,
            state: incident.state,
            decision: incident.decision,
            decisionSource: incident.decisionSource
          });
        } catch (err) {
          if (err instanceof IncidentNotFoundError) {
            res.status(HTTP_STATUS.NOT_FOUND).json({ error: err.message });
            return;
          }
          if (err instanceof IncidentAlreadyResolvedError) {
            res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
            return;
          }
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: toErrorMessage(err, 'Failed to simulate decision')
          });
        }
      })();
    }
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
