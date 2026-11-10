import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { toErrorMessage } from '@zeromttr/utils';
import {
  type RecordDecision,
  InvalidDecisionSignatureError,
  IncidentNotFoundError,
  IncidentAlreadyResolvedError
} from '../application/index.js';
import type { IncidentDecisionAction } from '../domain/index.js';

export const DecisionPayloadSchema = z.object({
  action: z.enum(['approve', 'reject']),
  sig: z.string().min(1),
  exp: z.union([z.number().finite(), z.string().regex(/^\d+$/).transform(Number)])
});

export const SimulateDecisionPayloadSchema = z.object({
  incidentId: z.string().min(1),
  action: z.enum(['approve', 'reject'])
});

export function createDecisionRouter(
  recordDecision: RecordDecision,
  dashboardAuthMiddleware: (req: Request, res: Response, next: () => void) => void,
  liveDemoMiddleware?: (req: Request, res: Response, next: () => void) => void
): Router {
  const router = Router();

  // Production endpoint activated strictly by the signed email link
  router.post('/incidents/:id/decision', (req: Request, res: Response): void => {
    void (async () => {
      const idParam = req.params.id;
      const incidentId = Array.isArray(idParam) ? idParam[0] : idParam;

      const parsed = DecisionPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid decision payload',
          details: parsed.error.format()
        });
        return;
      }

      const { action, sig, exp } = parsed.data;

      try {
        const incident = await recordDecision.execute(
          incidentId,
          action as IncidentDecisionAction,
          sig,
          exp
        );
        res.status(200).json({
          success: true,
          incidentId: incident.id,
          state: incident.state,
          decision: incident.decision,
          decisionSource: incident.decisionSource
        });
      } catch (err) {
        if (err instanceof InvalidDecisionSignatureError) {
          res.status(403).json({ error: err.message });
          return;
        }
        if (err instanceof IncidentNotFoundError) {
          res.status(404).json({ error: err.message });
          return;
        }
        if (err instanceof IncidentAlreadyResolvedError) {
          res.status(409).json({ error: err.message });
          return;
        }
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to record decision')
        });
      }
    })();
  });

  // Demo simulation endpoint for evaluator UI during replay/interactive demo
  const demoMiddlewares = liveDemoMiddleware
    ? [dashboardAuthMiddleware, liveDemoMiddleware]
    : [dashboardAuthMiddleware];

  router.post(
    '/demo/simulate-decision',
    ...demoMiddlewares,
    (req: Request, res: Response): void => {
      void (async () => {
        const parsed = SimulateDecisionPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid simulate decision payload',
            details: parsed.error.format()
          });
          return;
        }

        const { incidentId, action } = parsed.data;

        try {
          const incident = await recordDecision.executeSimulated(
            incidentId,
            action as IncidentDecisionAction
          );
          res.status(200).json({
            success: true,
            simulated: true,
            incidentId: incident.id,
            state: incident.state,
            decision: incident.decision,
            decisionSource: incident.decisionSource
          });
        } catch (err) {
          if (err instanceof IncidentNotFoundError) {
            res.status(404).json({ error: err.message });
            return;
          }
          if (err instanceof IncidentAlreadyResolvedError) {
            res.status(409).json({ error: err.message });
            return;
          }
          res.status(500).json({
            error: toErrorMessage(err, 'Failed to simulate decision')
          });
        }
      })();
    }
  );

  return router;
}
