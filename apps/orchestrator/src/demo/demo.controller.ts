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
import { createTurnstileMiddleware, validateTurnstileConfigPair } from '../http/turnstile.js';
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

export const HealthyTrafficPayloadSchema = z
  .object({
    enable: z.boolean().optional().default(true)
  })
  .optional()
  .default({ enable: true });

export interface DemoRouterDependencies {
  demoControlPort: DemoControlPort;
  simulateDemoDecision: SimulateDemoDecision;
  replayRunner?: ReplayRunner;
  repository?: IncidentRepository;
  dashboardAuthMiddleware?: RequestHandler;
  liveDemoKey?: string;
  publicLiveDemo?: boolean;
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
  const pendingTargetResetIncidentIds = new Set<string>();
  let lifecycleQueue: Promise<void> = Promise.resolve();

  const runSerialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lifecycleQueue.then(fn, fn);
    lifecycleQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const publicLiveDemo = dependencies.publicLiveDemo === true;
  const turnstileSiteKey = dependencies.turnstileSiteKey?.trim() || null;
  const turnstileSecretKey = dependencies.turnstileSecretKey?.trim() || undefined;
  validateTurnstileConfigPair(turnstileSiteKey, turnstileSecretKey);

  const liveDemoAuth =
    dependencies.liveDemoMiddleware ??
    createLiveDemoKeyMiddleware(dependencies.liveDemoKey, { publicLiveDemo });

  const turnstileAuth =
    dependencies.turnstileMiddleware ??
    createTurnstileMiddleware({ secretKey: turnstileSecretKey });

  const authMiddlewares: RequestHandler[] = dependencies.dashboardAuthMiddleware
    ? [dependencies.dashboardAuthMiddleware]
    : [];

  // Expose runtime demo configuration to the dashboard without requiring image rebuilds
  router.get('/demo/config', ...authMiddlewares, (_req: Request, res: Response): void => {
    res.status(HTTP_STATUS.OK).json({
      publicLiveDemo,
      turnstileSiteKey,
      turnstileRequired: Boolean(turnstileSiteKey && turnstileSecretKey)
    });
  });

  // Trigger demo chaos (replay is public-demo accessible; live requires X-Live-Demo-Key unless PUBLIC_LIVE_DEMO=true)
  router.post(
    '/demo/chaos',
    ...authMiddlewares,
    turnstileAuth,
    (req: Request, res: Response): void => {
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

        await runSerialized(async () => {
          const now = Date.now();
          if (lastChaosTimestamp > 0 && now - lastChaosTimestamp < cooldownMs) {
            const remainingSeconds = Math.ceil((cooldownMs - (now - lastChaosTimestamp)) / 1000);
            res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
              code: 'SIMULATION_COOLDOWN',
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
        });
      })();
    }
  );

  // Reset demo (requires X-Live-Demo-Key if active session or any open incident is live)
  router.post(
    '/demo/reset',
    ...authMiddlewares,
    turnstileAuth,
    (req: Request, res: Response): void => {
      void runSerialized(async () => {
        let openIncidents: Awaited<ReturnType<IncidentRepository['findAll']>> = [];
        if (dependencies.repository) {
          try {
            const allIncidents = await dependencies.repository.findAll();
            openIncidents = allIncidents.filter(
              (inc) =>
                inc.state !== IncidentState.RESOLVED &&
                inc.state !== IncidentState.REJECTED &&
                inc.state !== IncidentState.FAILED
            );
          } catch (err) {
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
              error: toErrorMessage(err, 'Failed to inspect open incidents before reset')
            });
            return;
          }
        }

        const hasLiveSessionOrIncident =
          (lastChaosTimestamp > 0 && lastChaosMode === IncidentExecutionMode.LIVE) ||
          openIncidents.some((inc) => inc.mode === IncidentExecutionMode.LIVE);

        if (hasLiveSessionOrIncident) {
          const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
          if (!allowed) {
            return;
          }
        }

        try {
          const failedIncidentIds: string[] = [];
          if (dependencies.repository) {
            for (const inc of openIncidents) {
              try {
                inc.transition(IncidentState.FAILED, 'Demo reset by operator');
                await dependencies.repository.save(inc);
              } catch {
                failedIncidentIds.push(inc.id);
              }
            }
          }

          dependencies.replayRunner?.stop();
          await dependencies.demoControlPort.reset();
          pendingTargetResetIncidentIds.clear();
          lastChaosTimestamp = 0;
          lastChaosMode = IncidentExecutionMode.REPLAY;

          if (failedIncidentIds.length > 0) {
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
              error: `Failed to transition/save open incidents during reset: ${failedIncidentIds.join(', ')}`,
              failedIncidentIds
            });
            return;
          }

          res.status(HTTP_STATUS.ACCEPTED).json({
            status: HttpResponseStatus.ACCEPTED,
            message: 'Service restored and demo state reset'
          });
        } catch (err) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: toErrorMessage(err, 'Failed to reset demo')
          });
        }
      });
    }
  );

  // Interactive simulated decision (requires X-Live-Demo-Key when targeting a live incident)
  router.post(
    '/demo/simulate-decision',
    ...authMiddlewares,
    turnstileAuth,
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
        await runSerialized(async () => {
          let existingIncident: Awaited<ReturnType<IncidentRepository['findById']>> = null;
          let completeApprovalReset: (() => Promise<void>) | null = null;
          try {
            existingIncident = dependencies.repository
              ? await dependencies.repository.findById(incidentId)
              : null;

            const isLiveSessionActive =
              lastChaosTimestamp > 0 && lastChaosMode === IncidentExecutionMode.LIVE;
            const requiresLiveAuth =
              (existingIncident !== null && existingIncident.mode === IncidentExecutionMode.LIVE) ||
              (action === DecisionAction.APPROVE && isLiveSessionActive);

            if (requiresLiveAuth) {
              const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
              if (!allowed) {
                return;
              }
            }

            completeApprovalReset = async (): Promise<void> => {
              pendingTargetResetIncidentIds.add(incidentId);
              dependencies.replayRunner?.stop();
              await dependencies.demoControlPort.reset();
              lastChaosTimestamp = 0;
              lastChaosMode = IncidentExecutionMode.REPLAY;
              pendingTargetResetIncidentIds.delete(incidentId);
            };

            const incident = await dependencies.simulateDemoDecision.execute(incidentId, action);
            if (action === DecisionAction.APPROVE) {
              await completeApprovalReset();
            }
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
              if (
                action === DecisionAction.APPROVE &&
                pendingTargetResetIncidentIds.has(incidentId) &&
                existingIncident &&
                completeApprovalReset
              ) {
                try {
                  await completeApprovalReset();
                  res.status(HTTP_STATUS.OK).json({
                    success: true,
                    simulated: true,
                    incidentId: existingIncident.id,
                    state: existingIncident.state,
                    decision: existingIncident.decision,
                    decisionSource: existingIncident.decisionSource
                  });
                  return;
                } catch (resetErr) {
                  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                    error: toErrorMessage(resetErr, 'Failed to restore service after decision')
                  });
                  return;
                }
              }
              res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
              return;
            }
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
              error: toErrorMessage(err, 'Failed to simulate decision')
            });
          }
        });
      })();
    }
  );

  // Toggle continuous healthy synthetic traffic on target workload (protected by X-Live-Demo-Key unless PUBLIC_LIVE_DEMO=true)
  router.post(
    '/demo/healthy-traffic',
    ...authMiddlewares,
    turnstileAuth,
    (req: Request, res: Response): void => {
      void (async () => {
        const parsed = HealthyTrafficPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: 'Invalid healthy traffic payload',
            details: parsed.error.format()
          });
          return;
        }

        const allowed = await runExpressMiddleware(liveDemoAuth, req, res);
        if (!allowed) {
          return;
        }

        try {
          await dependencies.demoControlPort.toggleHealthyTraffic(parsed.data.enable);
          res.status(HTTP_STATUS.OK).json({
            success: true,
            healthyTrafficActive: parsed.data.enable
          });
        } catch (err) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: toErrorMessage(err, 'Failed to toggle healthy traffic')
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
