import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isArray, toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import type { RecordDecision } from '../application/record-decision.js';
import {
  InvalidDecisionSignatureError,
  IncidentNotFoundError,
  IncidentAlreadyResolvedError
} from '../application/decision-helpers.js';
import { DecisionAction } from '../domain/incident-enums.js';

export const DecisionPayloadSchema = z.object({
  action: z.enum([DecisionAction.APPROVE, DecisionAction.REJECT]),
  sig: z.string().min(1),
  exp: z.union([z.number().finite(), z.string().regex(/^\d+$/).transform(Number)])
});

export function createDecisionRouter(recordDecision: RecordDecision): Router {
  const router = Router();

  // Production endpoint activated strictly by the signed email link
  router.post('/incidents/:id/decision', (req: Request, res: Response): void => {
    void (async () => {
      const idParam = req.params.id;
      const incidentId = isArray(idParam) ? idParam[0] : idParam;

      const parsed = DecisionPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: 'Invalid decision payload',
          details: parsed.error.format()
        });
        return;
      }

      const { action, sig, exp } = parsed.data;

      try {
        const incident = await recordDecision.execute(incidentId, action, sig, exp);
        res.status(HTTP_STATUS.OK).json({
          success: true,
          incidentId: incident.id,
          state: incident.state,
          decision: incident.decision,
          decisionSource: incident.decisionSource
        });
      } catch (err) {
        if (err instanceof InvalidDecisionSignatureError) {
          res.status(HTTP_STATUS.FORBIDDEN).json({ error: err.message });
          return;
        }
        if (err instanceof IncidentNotFoundError) {
          res.status(HTTP_STATUS.NOT_FOUND).json({ error: err.message });
          return;
        }
        if (err instanceof IncidentAlreadyResolvedError) {
          res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
          return;
        }
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to record decision')
        });
      }
    })();
  });

  return router;
}
