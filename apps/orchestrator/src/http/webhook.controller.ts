import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import type { HandleAlert } from '../application/handle-alert.js';
import type { OrchestratorWorkflow } from '../application/orchestrator-workflow.js';
import { HttpResponseStatus } from './http-constants.js';

/**
 * Mounts the Grafana Alert webhook receiver and asynchronously triggers incident orchestration.
 */
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

        if (result.ignored || !result.incident) {
          res.status(HTTP_STATUS.ACCEPTED).json({
            status: HttpResponseStatus.IGNORED,
            ignored: true,
            isDuplicate: false
          });
          return;
        }

        const incidentId = result.incident.id;

        // Trigger asynchronous background orchestration
        if (!result.isDuplicate) {
          setImmediate(() => {
            void workflow.runFullPipeline(incidentId);
          });
        }

        res.status(HTTP_STATUS.ACCEPTED).json({
          status: HttpResponseStatus.ACCEPTED,
          incidentId,
          isDuplicate: result.isDuplicate
        });
      } catch (err) {
        if (err instanceof ZodError) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: 'Invalid Grafana Alert webhook payload',
            details: err.format()
          });
          return;
        }
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to process Grafana alert')
        });
      }
    })();
  });

  return router;
}
