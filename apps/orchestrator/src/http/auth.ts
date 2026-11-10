import type { Request, Response, NextFunction } from 'express';
import { isNonEmptyString } from '@zeromttr/utils';

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return isNonEmptyString(token) ? token : null;
  }
  if (req.query && isNonEmptyString(req.query.token)) {
    return req.query.token.trim();
  }
  return null;
}

export function createGrafanaAuthMiddleware(grafanaToken: string, dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);

    if (!token) {
      res.status(401).json({ error: 'Missing Grafana webhook authorization token' });
      return;
    }

    // Critical AC: explicitly reject requests trying to use DASHBOARD_API_TOKEN
    if (token === dashboardToken && token !== grafanaToken) {
      res.status(403).json({
        error: 'Forbidden: DASHBOARD_API_TOKEN is not authorized for Grafana webhook endpoint'
      });
      return;
    }

    if (token !== grafanaToken) {
      res.status(401).json({ error: 'Invalid Grafana webhook authorization token' });
      return;
    }

    next();
  };
}

export function createDashboardAuthMiddleware(dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);

    if (!token || token !== dashboardToken) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing DASHBOARD_API_TOKEN' });
      return;
    }

    next();
  };
}

export function createLiveDemoKeyMiddleware(configuredKey?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!configuredKey) {
      next();
      return;
    }

    const liveKeyHeader = req.headers['x-live-demo-key'];
    if (!liveKeyHeader || liveKeyHeader !== configuredKey) {
      res.status(403).json({
        error: 'Forbidden: Valid X-Live-Demo-Key required for live execution on public host'
      });
      return;
    }

    next();
  };
}
