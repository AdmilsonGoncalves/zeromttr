import { Router, type Request, type Response } from 'express';
import { toErrorMessage } from '@zeromttr/utils';
import type { IncidentMode } from '../domain/index.js';
import type { IncidentRepository, TargetStatusPort } from '../ports/index.js';
import type { SseEventBroadcaster } from './events.sse.js';

function isIncidentMode(val: unknown): val is IncidentMode {
  return val === 'live' || val === 'replay';
}

export function createApiRouter(
  repository: IncidentRepository,
  targetStatusPort: TargetStatusPort,
  broadcaster: SseEventBroadcaster,
  dashboardAuthMiddleware: (req: Request, res: Response, next: () => void) => void,
  liveDemoMiddleware?: (req: Request, res: Response, next: () => void) => void,
  cooldownMs = 120_000
): Router {
  const router = Router();
  let lastChaosTimestamp = 0;

  // All /api endpoints require DASHBOARD_API_TOKEN
  router.use(dashboardAuthMiddleware);

  // SSE Stream
  router.get('/events', (req: Request, res: Response) => {
    broadcaster.handleConnection(req, res);
  });

  // Incident summary list
  router.get('/incidents', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const incidents = await repository.findAll();
        res.status(200).json(incidents.map((i) => i.toSummary()));
      } catch (err) {
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to list incidents')
        });
      }
    })();
  });

  // Incident detail (Never exposes HMAC signature or secrets!)
  router.get('/incidents/:id', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const incident = await repository.findById(id);
        if (!incident) {
          res.status(404).json({ error: `Incident '${id}' not found` });
          return;
        }

        const detail = incident.toDetail();
        // Defensive check: guarantee sig is never exposed
        const sanitized = JSON.parse(JSON.stringify(detail));
        delete sanitized.approveSig;
        delete sanitized.rejectSig;
        delete sanitized.sig;

        res.status(200).json(sanitized);
      } catch (err) {
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to fetch incident')
        });
      }
    })();
  });

  // Target status proxy
  router.get('/target/status', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const status = await targetStatusPort.getStatus();
        res.status(200).json(status);
      } catch (err) {
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to fetch target status')
        });
      }
    })();
  });

  const demoMiddlewares = liveDemoMiddleware ? [liveDemoMiddleware] : [];

  // Trigger demo chaos (live or replay)
  router.post('/demo/chaos', ...demoMiddlewares, (req: Request, res: Response): void => {
    void (async () => {
      const now = Date.now();
      if (lastChaosTimestamp > 0 && now - lastChaosTimestamp < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - (now - lastChaosTimestamp)) / 1000);
        res.status(429).json({
          error: `Chaos simulation is in cooldown. Please wait ${remainingSeconds} seconds before triggering again.`,
          retryAfterSeconds: remainingSeconds
        });
        return;
      }

      const previousTimestamp = lastChaosTimestamp;
      lastChaosTimestamp = now;

      try {
        const rawMode = req.body?.mode;
        const mode: IncidentMode = isIncidentMode(rawMode) ? rawMode : 'replay';
        if (mode === 'live') {
          await targetStatusPort.triggerChaos(true);
        }
        res.status(202).json({
          status: 'accepted',
          mode,
          message: 'Chaos simulation initialized'
        });
      } catch (err) {
        lastChaosTimestamp = previousTimestamp;
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to initialize chaos')
        });
      }
    })();
  });

  // Reset demo
  router.post('/demo/reset', ...demoMiddlewares, (req: Request, res: Response): void => {
    void (async () => {
      try {
        lastChaosTimestamp = 0;
        await targetStatusPort.reset();
        res.status(202).json({
          status: 'accepted',
          message: 'Service restored and demo state reset'
        });
      } catch (err) {
        res.status(500).json({
          error: toErrorMessage(err, 'Failed to reset demo')
        });
      }
    })();
  });

  return router;
}
