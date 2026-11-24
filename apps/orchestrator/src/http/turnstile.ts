import type { NextFunction, Request, Response } from 'express';
import { isNonEmptyString, isObject, isString } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { extractClientIp } from './rate-limit.js';

const DEFAULT_TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;

export interface TurnstileMiddlewareOptions {
  secretKey?: string;
  verifyUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Validates that Turnstile site key and secret key are either both configured or both unset.
 */
export function validateTurnstileConfigPair(
  siteKey?: string | null,
  secretKey?: string | null
): void {
  const hasSiteKey = isNonEmptyString(siteKey);
  const hasSecretKey = isNonEmptyString(secretKey);
  if (hasSiteKey !== hasSecretKey) {
    throw new Error(
      'FATAL: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be configured or both be unset.'
    );
  }
}

/**
 * Extracts a Cloudflare Turnstile token from the request header or body.
 */
function extractTurnstileToken(req: Request): string | null {
  const headerToken = req.headers['cf-turnstile-response'];
  if (isString(headerToken) && isNonEmptyString(headerToken)) {
    return headerToken.trim();
  }
  if (isObject(req.body)) {
    const bodyToken = (req.body as Record<string, unknown>).turnstileToken;
    if (isString(bodyToken) && isNonEmptyString(bodyToken)) {
      return bodyToken.trim();
    }
  }
  return null;
}

/**
 * Creates Express middleware verifying Cloudflare Turnstile tokens when `secretKey` is configured.
 */
export function createTurnstileMiddleware(options: TurnstileMiddlewareOptions) {
  const secretKey = options.secretKey?.trim();
  const verifyUrl = options.verifyUrl ?? DEFAULT_TURNSTILE_VERIFY_URL;
  const fetchFn = options.fetchFn ?? fetch;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isNonEmptyString(secretKey)) {
      next();
      return;
    }

    const token = extractTurnstileToken(req);
    if (!token) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        code: 'TURNSTILE_REQUIRED',
        error: 'Forbidden: Cloudflare Turnstile verification required'
      });
      return;
    }

    void (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
      try {
        const remoteip = extractClientIp(req);
        const body = new URLSearchParams({
          secret: secretKey,
          response: token,
          ...(remoteip !== 'unknown' ? { remoteip } : {})
        });

        const verifyRes = await fetchFn(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal
        });

        if (!verifyRes.ok) {
          res.status(HTTP_STATUS.FORBIDDEN).json({
            code: 'TURNSTILE_FAILED',
            error: 'Forbidden: Cloudflare Turnstile verification failed'
          });
          return;
        }

        const payload = (await verifyRes.json()) as { success?: unknown };
        if (payload?.success !== true) {
          res.status(HTTP_STATUS.FORBIDDEN).json({
            code: 'TURNSTILE_REJECTED',
            error: 'Forbidden: Cloudflare Turnstile verification rejected'
          });
          return;
        }

        next();
      } catch {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          code: 'TURNSTILE_UNAVAILABLE',
          error: 'Forbidden: Cloudflare Turnstile verification unavailable'
        });
      } finally {
        clearTimeout(timer);
      }
    })();
  };
}
