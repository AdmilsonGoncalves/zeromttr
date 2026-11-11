import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { isNonEmptyString } from '@zeromttr/utils';

export function safeTokenCompare(
  tokenA: string | null | undefined,
  tokenB: string | null | undefined
): boolean {
  if (!isNonEmptyString(tokenA) || !isNonEmptyString(tokenB)) {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(tokenA).digest();
  const hashB = crypto.createHash('sha256').update(tokenB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function extractBearerToken(req: Request, allowQuery = false): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (isNonEmptyString(token)) {
      return token;
    }
  }
  const pathname = req.originalUrl?.split('?')[0] || req.path || '';
  const isEventsRoute =
    pathname === '/api/events' || pathname === '/events' || req.path === '/events';
  if ((allowQuery || isEventsRoute) && req.query && isNonEmptyString(req.query.token)) {
    return req.query.token.trim();
  }
  return null;
}

export function createGrafanaAuthMiddleware(grafanaToken: string, dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req, false);

    if (!token) {
      res.status(401).json({ error: 'Missing Grafana webhook authorization token' });
      return;
    }

    // Critical AC: explicitly reject requests trying to use DASHBOARD_API_TOKEN
    if (safeTokenCompare(token, dashboardToken) && !safeTokenCompare(token, grafanaToken)) {
      res.status(403).json({
        error: 'Forbidden: DASHBOARD_API_TOKEN is not authorized for Grafana webhook endpoint'
      });
      return;
    }

    if (!safeTokenCompare(token, grafanaToken)) {
      res.status(401).json({ error: 'Invalid Grafana webhook authorization token' });
      return;
    }

    next();
  };
}

export function createDashboardAuthMiddleware(dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);

    if (!token || !safeTokenCompare(token, dashboardToken)) {
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

    const liveKeyHeader =
      typeof req.headers['x-live-demo-key'] === 'string'
        ? req.headers['x-live-demo-key']
        : undefined;
    if (!liveKeyHeader || !safeTokenCompare(liveKeyHeader, configuredKey)) {
      res.status(403).json({
        error: 'Forbidden: Valid X-Live-Demo-Key required for live execution on public host'
      });
      return;
    }

    next();
  };
}
