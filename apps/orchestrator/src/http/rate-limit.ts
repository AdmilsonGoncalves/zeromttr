import type { NextFunction, Request, Response } from 'express';
import { isNonEmptyString, normalizeIp, parseForwardedIp } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';

export interface IpRateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  clock?: () => number;
  trustCloudflareHeaders?: boolean;
}

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

const PRIVATE_IPV4_RANGES = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[0-1])\./];

function isTrustedProxyIp(ip: string): boolean {
  const normalized = normalizeIp(ip).toLowerCase();
  if (normalized === '::1' || normalized === 'localhost') {
    return true;
  }
  if (PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return (
    normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
  );
}

/**
 * Extracts the client IP address from trusted proxy headers or the direct socket peer.
 */
export function extractClientIp(
  req: Request,
  options: { trustCloudflareHeaders?: boolean } = {}
): string {
  const rawPeerIp = isNonEmptyString(req.socket?.remoteAddress)
    ? req.socket.remoteAddress
    : isNonEmptyString(req.ip)
      ? req.ip
      : '';
  const peerIp = isNonEmptyString(rawPeerIp) ? normalizeIp(rawPeerIp) : 'unknown';

  const trustCloudflare =
    options.trustCloudflareHeaders ??
    (process.env.NODE_ENV === 'test' || process.env.TRUST_CLOUDFLARE_HEADERS === 'true');

  if (peerIp !== 'unknown' && isTrustedProxyIp(peerIp)) {
    if (trustCloudflare) {
      const cfIp = parseForwardedIp(req.headers['cf-connecting-ip']);
      if (cfIp) {
        return cfIp;
      }
    }

    const forwardedIp = parseForwardedIp(req.headers['x-forwarded-for']);
    if (forwardedIp) {
      return forwardedIp;
    }

    const realIp = parseForwardedIp(req.headers['x-real-ip']);
    if (realIp) {
      return realIp;
    }
  }

  return peerIp;
}

/**
 * Creates an in-memory per-IP rate limiting middleware using fixed windows.
 */
export function createIpRateLimitMiddleware(options: IpRateLimitOptions) {
  const buckets = new Map<string, RateLimitBucket>();
  const clock = options.clock ?? (() => Date.now());
  const windowMs = Math.max(1000, options.windowMs);
  const maxRequests = Math.max(1, options.maxRequests);
  const errorMessage =
    options.message ?? 'Too many requests from this IP. Please slow down and try again shortly.';

  const pruneExpiredBuckets = (now: number): void => {
    if (buckets.size < 256) {
      return;
    }
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAtMs <= now) {
        buckets.delete(key);
      }
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = clock();
    pruneExpiredBuckets(now);

    const ip = extractClientIp(req, { trustCloudflareHeaders: options.trustCloudflareHeaders });
    const existing = buckets.get(ip);

    if (!existing || existing.resetAtMs <= now) {
      buckets.set(ip, { count: 1, resetAtMs: now + windowMs });
      res.setHeader('RateLimit-Limit', String(maxRequests));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - 1)));
      next();
      return;
    }

    existing.count += 1;
    const remaining = Math.max(0, maxRequests - existing.count);
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(remaining));

    if (existing.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        code: 'RATE_LIMIT_EXCEEDED',
        error: errorMessage,
        retryAfterSeconds
      });
      return;
    }

    next();
  };
}
