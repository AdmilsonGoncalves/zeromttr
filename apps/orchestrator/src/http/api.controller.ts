import { Router, type Request, type Response } from 'express';
import { isArray, isObject, omit, safeJsonParse, toErrorMessage } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import type { IncidentRepository, TargetStatusPort } from '../ports/index.js';
import type { SseEventBroadcaster } from './events.sse.js';

export function createApiRouter(
  repository: IncidentRepository,
  targetStatusPort: TargetStatusPort,
  broadcaster: SseEventBroadcaster,
  dashboardAuthMiddleware: (req: Request, res: Response, next: () => void) => void
): Router {
  const router = Router();

  // All /api operational endpoints require DASHBOARD_API_TOKEN
  router.use(dashboardAuthMiddleware);

  // SSE Stream
  router.get('/events', (req: Request, res: Response) => {
    broadcaster.handleConnection(req, res);
  });

  // Incident summary list
  router.get('/incidents', (_req: Request, res: Response): void => {
    void (async () => {
      try {
        const incidents = await repository.findAll();
        res.status(HTTP_STATUS.OK).json(incidents.map((i) => i.toSummary()));
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to list incidents')
        });
      }
    })();
  });

  // Incident detail (Never exposes HMAC signature or secrets!)
  router.get('/incidents/:id', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const id = isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const incident = await repository.findById(id);
        if (!incident) {
          res.status(HTTP_STATUS.NOT_FOUND).json({ error: `Incident '${id}' not found` });
          return;
        }

        const detail = incident.toDetail();
        // Defensive check: guarantee sig is never exposed
        const parsed = safeJsonParse(JSON.stringify(detail));
        const sanitized = isObject(parsed)
          ? omit(parsed, ['approveSig', 'rejectSig', 'sig'])
          : detail;

        res.status(HTTP_STATUS.OK).json(sanitized);
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to fetch incident')
        });
      }
    })();
  });

  // Target status proxy
  router.get('/target/status', (_req: Request, res: Response): void => {
    void (async () => {
      try {
        const status = await targetStatusPort.getStatus();
        res.status(HTTP_STATUS.OK).json(status);
      } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          error: toErrorMessage(err, 'Failed to fetch target status')
        });
      }
    })();
  });

  return router;
}
