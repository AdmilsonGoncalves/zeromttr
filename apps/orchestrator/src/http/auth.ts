import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { isEmpty, isNonEmptyString, isString } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';

/**
 * Performs a constant-time SHA-256 comparison between two secret token strings.
 */
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

/**
 * Extracts a Bearer token from the `Authorization` header or permitted SSE query parameters.
 */
export function extractBearerToken(req: Request, allowQuery = false): string | null {
  const authHeader = req.headers.authorization;
  if (isNonEmptyString(authHeader) && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (isNonEmptyString(token)) {
      return token;
    }
  }
  const pathname = req.originalUrl?.split('?')[0] || req.path || '';
  const isEventsRoute =
    req.method === 'GET' && (pathname === '/api/events' || pathname === '/events');
  if ((allowQuery || isEventsRoute) && req.query && isNonEmptyString(req.query.token)) {
    return req.query.token.trim();
  }
  return null;
}

/**
 * Creates Express middleware enforcing `GRAFANA_WEBHOOK_TOKEN` while rejecting `DASHBOARD_API_TOKEN`.
 */
export function createGrafanaAuthMiddleware(grafanaToken: string, dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req, false);

    if (!token) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Missing Grafana webhook authorization token' });
      return;
    }

    // Critical AC: explicitly reject requests trying to use DASHBOARD_API_TOKEN
    if (safeTokenCompare(token, dashboardToken) && !safeTokenCompare(token, grafanaToken)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: 'Forbidden: DASHBOARD_API_TOKEN is not authorized for Grafana webhook endpoint'
      });
      return;
    }

    if (!safeTokenCompare(token, grafanaToken)) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Invalid Grafana webhook authorization token' });
      return;
    }

    next();
  };
}

/**
 * Creates Express middleware requiring a valid `DASHBOARD_API_TOKEN` on `/api/*` routes.
 */
export function createDashboardAuthMiddleware(dashboardToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);

    if (!token || !safeTokenCompare(token, dashboardToken)) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ error: 'Unauthorized: invalid or missing DASHBOARD_API_TOKEN' });
      return;
    }

    next();
  };
}

/**
 * Creates Express middleware validating `X-Live-Demo-Key` when configured for public hosts.
 */
export function createLiveDemoKeyMiddleware(configuredKey?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isEmpty(configuredKey)) {
      const env = process.env.NODE_ENV;
      const isLocalDevOrTest = !env || env === 'development' || env === 'test';
      if (!isLocalDevOrTest) {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          error:
            'Forbidden: LIVE_DEMO_KEY must be configured for live execution outside local dev/test'
        });
        return;
      }
      next();
      return;
    }

    const rawHeader = req.headers['x-live-demo-key'];
    const liveKeyHeader = isString(rawHeader) ? rawHeader : undefined;
    if (!liveKeyHeader || !safeTokenCompare(liveKeyHeader, configuredKey)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        error: 'Forbidden: Valid X-Live-Demo-Key required for live execution on public host'
      });
      return;
    }

    next();
  };
}
