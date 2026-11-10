import type http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isEmpty } from '@zeromttr/utils';

export function verifyAuthToken(req: http.IncomingMessage, expectedToken: string): boolean {
  if (isEmpty(expectedToken)) {
    return false;
  } // fail-closed if no token configured

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return false;
  }

  const token = parts[1].trim();
  const digest = (v: string) => createHash('sha256').update(v.trim()).digest();
  return timingSafeEqual(digest(token), digest(expectedToken));
}

export function handleAuthMiddleware(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  expectedToken: string
): boolean {
  // Public routes
  if (req.url === '/health' || req.url === '/') {
    return true;
  }

  const authorized = verifyAuthToken(req, expectedToken);
  if (!authorized) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer error="invalid_token"'
    });
    res.end(
      JSON.stringify({
        error: 'Unauthorized',
        message: 'Invalid or missing Authorization header'
      })
    );
    return false;
  }

  return true;
}
