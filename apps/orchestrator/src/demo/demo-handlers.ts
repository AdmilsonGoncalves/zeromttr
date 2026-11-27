import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import {
  IncidentAlreadyResolvedError,
  IncidentNotFoundError
} from '../application/decision-helpers.js';
import { DecisionAction, IncidentExecutionMode } from '../domain/incident-enums.js';
import type { Incident, IncidentMode } from '../domain/incident.js';
import { IncidentState } from '../domain/incident-state.js';
import { DemoErrorCode, HttpResponseStatus } from '../http/http-constants.js';
import type { IncidentRepository } from '../ports/incident-repository.port.js';
import type { DemoControlPort } from './demo-control.port.js';
import { asAsyncHandler, parseDemoPayload, type DemoAccessGuards } from './demo-guards.js';
import type { DemoSessionLifecycle } from './demo-session-lifecycle.js';
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

export interface DemoHandlerDependencies {
  guards: DemoAccessGuards;
  lifecycle: DemoSessionLifecycle;
  demoControlPort: DemoControlPort;
  simulateDemoDecision: SimulateDemoDecision;
  replayRunner?: ReplayRunner;
  repository?: IncidentRepository;
  cooldownMs: number;
}

function checkSimulationCooldown(
  lifecycle: DemoSessionLifecycle,
  cooldownMs: number,
  now: number,
  res: Response
): boolean {
  const currentChaosTimestamp = lifecycle.getLastChaosTimestamp();
  if (currentChaosTimestamp > 0 && now - currentChaosTimestamp < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - (now - currentChaosTimestamp)) / 1000);
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      code: DemoErrorCode.SIMULATION_COOLDOWN,
      error: `Chaos simulation is in cooldown. Please wait ${remainingSeconds} seconds before triggering again.`,
      retryAfterSeconds: remainingSeconds
    });
    return false;
  }
  return true;
}

async function loadOpenIncidents(repository?: IncidentRepository): Promise<Incident[]> {
  if (!repository) {
    return [];
  }
  const allIncidents = await repository.findAll();
  return allIncidents.filter(
    (inc) =>
      inc.state !== IncidentState.RESOLVED &&
      inc.state !== IncidentState.REJECTED &&
      inc.state !== IncidentState.FAILED
  );
}

async function markIncidentsFailedOnReset(
  repository: IncidentRepository | undefined,
  openIncidents: Incident[]
): Promise<string[]> {
  if (!repository) {
    return [];
  }
  const failedIncidentIds: string[] = [];
  for (const inc of openIncidents) {
    try {
      inc.transition(IncidentState.FAILED, 'Demo reset by operator');
      await repository.save(inc);
    } catch {
      failedIncidentIds.push(inc.id);
    }
  }
  return failedIncidentIds;
}

function sendSimulatedDecisionResponse(res: Response, incident: Incident): void {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    simulated: true,
    incidentId: incident.id,
    state: incident.state,
    decision: incident.decision,
    decisionSource: incident.decisionSource
  });
}

async function handleSimulateDecisionError(
  err: unknown,
  res: Response,
  options: {
    incidentId: string;
    action: DecisionAction;
    existingIncident: Incident | null;
    lifecycle: DemoSessionLifecycle;
  }
): Promise<void> {
  if (err instanceof IncidentNotFoundError) {
    res.status(HTTP_STATUS.NOT_FOUND).json({ error: err.message });
    return;
  }

  if (err instanceof IncidentAlreadyResolvedError) {
    const canFinishPendingReset =
      options.action === DecisionAction.APPROVE &&
      options.lifecycle.hasPendingTargetReset(options.incidentId) &&
      options.existingIncident !== null;

    if (canFinishPendingReset && options.existingIncident) {
      try {
        await options.lifecycle.completeApprovalReset(options.incidentId);
        sendSimulatedDecisionResponse(res, options.existingIncident);
      } catch (resetErr) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(resetErr, 'Failed to restore service after decision')
        });
      }
      return;
    }

    res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
    return;
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: toErrorMessage(err, 'Failed to simulate decision')
  });
}

/**
 * Exposes runtime demo configuration to the dashboard without requiring image rebuilds.
 */
export function createDemoConfigHandler(guards: DemoAccessGuards): RequestHandler {
  return (_req: Request, res: Response): void => {
    res.status(HTTP_STATUS.OK).json(guards.getRuntimeConfig());
  };
}

/**
 * Handles `POST /demo/chaos` execution across live and replay modes with cooldown and capability guards.
 */
export function createDemoChaosHandler(
  deps: Pick<
    DemoHandlerDependencies,
    'guards' | 'lifecycle' | 'demoControlPort' | 'replayRunner' | 'cooldownMs'
  >
): RequestHandler {
  return asAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const payload = parseDemoPayload(
      DemoChaosPayloadSchema,
      req.body,
      res,
      'Invalid demo chaos payload'
    );
    if (!payload) {
      return;
    }

    const mode: IncidentMode = payload.mode;
    if (mode === IncidentExecutionMode.LIVE) {
      const allowed = await deps.guards.authorizeLiveDemo(req, res);
      if (!allowed) {
        return;
      }
    }

    await deps.lifecycle.runSerialized(async () => {
      const replayRunner = deps.replayRunner;
      if (mode === IncidentExecutionMode.LIVE) {
        const supported = await deps.guards.checkCapability(
          'chaosSimulation',
          res,
          'Target service does not support live chaos simulation'
        );
        if (!supported) {
          return;
        }
      } else if (!replayRunner) {
        res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
          code: DemoErrorCode.REPLAY_UNAVAILABLE,
          error: 'Replay mode is not configured on this orchestrator instance'
        });
        return;
      }

      const now = Date.now();
      if (!checkSimulationCooldown(deps.lifecycle, deps.cooldownMs, now, res)) {
        return;
      }

      const previousSnapshot = deps.lifecycle.getLastChaosSnapshot();
      deps.lifecycle.setProvisionalLastChaos(now, mode);

      try {
        let incidentId: string | undefined;
        if (mode === IncidentExecutionMode.LIVE) {
          replayRunner?.stop();
          await deps.demoControlPort.triggerChaos(true);
        } else if (replayRunner) {
          incidentId = await replayRunner.trigger();
        }
        deps.lifecycle.commitLastChaos();
        res.status(HTTP_STATUS.ACCEPTED).json({
          status: HttpResponseStatus.ACCEPTED,
          mode,
          ...(incidentId ? { incidentId } : {}),
          message: 'Chaos simulation initialized'
        });
      } catch (err) {
        deps.lifecycle.restoreLastChaos(previousSnapshot);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to initialize chaos')
        });
      }
    });
  });
}

/**
 * Handles `POST /demo/reset` restoring the target service and closing open demo incidents.
 */
export function createDemoResetHandler(
  deps: Pick<
    DemoHandlerDependencies,
    'guards' | 'lifecycle' | 'demoControlPort' | 'replayRunner' | 'repository'
  >
): RequestHandler {
  return asAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    await deps.lifecycle.runSerialized(async () => {
      let openIncidents: Incident[] = [];
      try {
        openIncidents = await loadOpenIncidents(deps.repository);
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to inspect open incidents before reset')
        });
        return;
      }

      const hasLiveSessionOrIncident =
        (deps.lifecycle.getLastChaosTimestamp() > 0 &&
          deps.lifecycle.getLastChaosMode() === IncidentExecutionMode.LIVE) ||
        deps.lifecycle.hasPendingLiveReset() ||
        openIncidents.some((inc) => inc.mode === IncidentExecutionMode.LIVE);

      if (hasLiveSessionOrIncident) {
        const allowed = await deps.guards.authorizeLiveDemo(req, res);
        if (!allowed) {
          return;
        }
        deps.lifecycle.markPendingLiveReset();
      }

      try {
        const failedIncidentIds = await markIncidentsFailedOnReset(deps.repository, openIncidents);

        deps.replayRunner?.stop();
        const shouldResetTarget = await deps.lifecycle.canResetTarget();
        if (shouldResetTarget) {
          await deps.demoControlPort.reset();
        }
        deps.lifecycle.clearPendingLiveReset();
        deps.lifecycle.clearPendingTargetResets();
        deps.lifecycle.clearLastChaos();

        if (failedIncidentIds.length > 0) {
          res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: `Failed to transition/save open incidents during reset: ${failedIncidentIds.join(', ')}`,
            failedIncidentIds
          });
          return;
        }

        res.status(HTTP_STATUS.ACCEPTED).json({
          status: HttpResponseStatus.ACCEPTED,
          message: shouldResetTarget
            ? 'Service restored and demo state reset'
            : 'Demo state reset (target workload unchanged)'
        });
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to reset demo')
        });
      }
    });
  });
}

/**
 * Handles `POST /demo/simulate-decision` and triggers post-approval target cleanup when approved.
 */
export function createDemoSimulateDecisionHandler(
  deps: Pick<
    DemoHandlerDependencies,
    'guards' | 'lifecycle' | 'repository' | 'simulateDemoDecision'
  >
): RequestHandler {
  return asAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const payload = parseDemoPayload(
      SimulateDecisionPayloadSchema,
      req.body,
      res,
      'Invalid simulate decision payload'
    );
    if (!payload) {
      return;
    }

    const { incidentId, action } = payload;
    await deps.lifecycle.runSerialized(async () => {
      let existingIncident: Incident | null = null;
      try {
        existingIncident = deps.repository ? await deps.repository.findById(incidentId) : null;

        const isLiveSessionActive =
          (deps.lifecycle.getLastChaosTimestamp() > 0 &&
            deps.lifecycle.getLastChaosMode() === IncidentExecutionMode.LIVE) ||
          deps.lifecycle.hasPendingLiveReset();
        const requiresLiveAuth =
          (existingIncident !== null && existingIncident.mode === IncidentExecutionMode.LIVE) ||
          (action === DecisionAction.APPROVE && isLiveSessionActive);

        if (requiresLiveAuth) {
          const allowed = await deps.guards.authorizeLiveDemo(req, res);
          if (!allowed) {
            return;
          }
        }

        const incident = await deps.simulateDemoDecision.execute(incidentId, action);
        if (action === DecisionAction.APPROVE) {
          if (requiresLiveAuth) {
            deps.lifecycle.markPendingLiveReset();
          }
          await deps.lifecycle.completeApprovalReset(incidentId);
        }
        sendSimulatedDecisionResponse(res, incident);
      } catch (err) {
        await handleSimulateDecisionError(err, res, {
          incidentId,
          action,
          existingIncident,
          lifecycle: deps.lifecycle
        });
      }
    });
  });
}

/**
 * Handles `POST /demo/healthy-traffic` toggling synthetic healthy workload traffic when supported.
 */
export function createDemoHealthyTrafficHandler(
  deps: Pick<DemoHandlerDependencies, 'guards' | 'demoControlPort'>
): RequestHandler {
  return asAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const payload = parseDemoPayload(
      HealthyTrafficPayloadSchema,
      req.body,
      res,
      'Invalid healthy traffic payload'
    );
    if (!payload) {
      return;
    }

    const allowed = await deps.guards.authorizeLiveDemo(req, res);
    if (!allowed) {
      return;
    }

    try {
      const supported = await deps.guards.checkCapability(
        'healthyTrafficToggle',
        res,
        'Target service does not support healthy traffic toggling'
      );
      if (!supported) {
        return;
      }

      await deps.demoControlPort.toggleHealthyTraffic(payload.enable);
      res.status(HTTP_STATUS.OK).json({
        success: true,
        healthyTrafficActive: payload.enable
      });
    } catch (err) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: toErrorMessage(err, 'Failed to toggle healthy traffic')
      });
    }
  });
}
