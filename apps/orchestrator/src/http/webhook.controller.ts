import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { toErrorMessage } from '@zeromttr/utils';
import type { HandleAlert, OrchestratorWorkflow } from '../application/index.js';

export function createWebhookRouter(
  handleAlert: HandleAlert,
  workflow: OrchestratorWorkflow,
  authMiddleware: (req: Request, res: Response, next: () => void) => void
): Router {
  const router = Router();

  router.post('/grafana-alert', authMiddleware, (req: Request, res: Response): void => {
    void (async () => {
      try {
        const result = await handleAlert.execute(req.body);

        // Trigger asynchronous background orchestration
        if (!result.isDuplicate) {
          setImmediate(() => {
            void workflow.runFullPipeline(result.incident.id);
          });
        }

        res.status(202).json({
          status: 'accepted',
          incidentId: result.incident.id,
          isDuplicate: result.isDuplicate
        });
      } catch (err) {
        if (err instanceof ZodError) {
          res.status(400).json({
            error: 'Invalid Grafana Alert webhook payload',
            details: err.format()
          });
          return;
        }
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to process Grafana alert')
        });
      }
    })();
  });

  return router;
}
