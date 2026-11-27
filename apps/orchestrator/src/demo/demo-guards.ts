import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { TargetHealthStatus } from '../domain/incident-enums.js';
import { createLiveDemoKeyMiddleware } from '../http/auth.js';
import { createTurnstileMiddleware, validateTurnstileConfigPair } from '../http/turnstile.js';
import { DemoErrorCode } from '../http/http-constants.js';
import type { TargetStatusPort } from '../ports/target-status.port.js';

export type TargetCapabilityKey = 'chaosSimulation' | 'healthyTrafficToggle';

export interface DemoRuntimeConfig {
  demoModeEnabled: boolean;
  requireDemoKey: boolean;
  publicLiveDemo: boolean;
  turnstileSiteKey: string | null;
  turnstileRequired: boolean;
}

export interface DemoGuardDependencies {
  targetStatusPort?: TargetStatusPort;
  dashboardAuthMiddleware?: RequestHandler;
  liveDemoKey?: string;
  publicLiveDemo?: boolean;
  requireDemoKey?: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  liveDemoMiddleware?: (req: Request, res: Response, next: NextFunction) => void;
  turnstileMiddleware?: RequestHandler;
}

export interface DemoAccessGuards {
  readonly dashboardMiddlewares: RequestHandler[];
  readonly turnstileMiddleware: RequestHandler;
  getRuntimeConfig(): DemoRuntimeConfig;
  authorizeLiveDemo(req: Request, res: Response): Promise<boolean>;
  checkCapability(
    capability: TargetCapabilityKey,
    res: Response,
    errorMessage: string
  ): Promise<boolean>;
}

function runExpressMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (allowed: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(allowed);
      }
    };

    res.once('finish', () => finish(false));
    middleware(req, res, () => finish(true));

    if (res.writableEnded || res.headersSent) {
      finish(false);
    }
  });
}

/**
 * Wraps an async Express route handler so ESLint `@typescript-eslint/no-misused-promises` stays clean.
 */
export function asAsyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response): void => {
    void handler(req, res);
  };
}

/**
 * Validates a request payload against a Zod schema, responding with 400 Bad Request on failure.
 */
export function parseDemoPayload<T>(
  schema: z.ZodType<T>,
  body: unknown,
  res: Response,
  errorMessage: string
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: errorMessage,
      details: parsed.error.format()
    });
    return null;
  }
  return parsed.data;
}

/**
 * Resolves runtime demo configuration, Turnstile, live-key auth, and target capability guards.
 */
export function createDemoAccessGuards(dependencies: DemoGuardDependencies): DemoAccessGuards {
  const requireDemoKey =
    dependencies.requireDemoKey !== undefined
      ? dependencies.requireDemoKey
      : dependencies.publicLiveDemo !== true;
  const publicLiveDemo = !requireDemoKey;
  const turnstileSiteKey = dependencies.turnstileSiteKey?.trim() || null;
  const turnstileSecretKey = dependencies.turnstileSecretKey?.trim() || undefined;
  validateTurnstileConfigPair(turnstileSiteKey, turnstileSecretKey);

  const liveDemoAuth =
    dependencies.liveDemoMiddleware ??
    createLiveDemoKeyMiddleware(dependencies.liveDemoKey, { publicLiveDemo });

  const turnstileMiddleware =
    dependencies.turnstileMiddleware ??
    createTurnstileMiddleware({ secretKey: turnstileSecretKey });

  const dashboardMiddlewares: RequestHandler[] = dependencies.dashboardAuthMiddleware
    ? [dependencies.dashboardAuthMiddleware]
    : [];

  return {
    dashboardMiddlewares,
    turnstileMiddleware,
    getRuntimeConfig: () => ({
      demoModeEnabled: true,
      requireDemoKey,
      publicLiveDemo,
      turnstileSiteKey,
      turnstileRequired: Boolean(turnstileSiteKey && turnstileSecretKey)
    }),
    authorizeLiveDemo: (req: Request, res: Response) =>
      runExpressMiddleware(liveDemoAuth, req, res),
    checkCapability: async (
      capability: TargetCapabilityKey,
      res: Response,
      errorMessage: string
    ): Promise<boolean> => {
      if (!dependencies.targetStatusPort) {
        return true;
      }
      const targetStatus = await dependencies.targetStatusPort.getStatus();
      if (
        targetStatus.status !== TargetHealthStatus.UNREACHABLE &&
        targetStatus.capabilities?.[capability] === false
      ) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          code: DemoErrorCode.CAPABILITY_NOT_SUPPORTED,
          error: errorMessage
        });
        return false;
      }
      return true;
    }
  };
}
