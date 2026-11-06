import type { Request, Response, NextFunction } from 'express';

/**
 * Main API (8081) paths that are still in use. Mist itself is served by the
 * separate Mist API (8082, /api/mist). Everything else mounted in index.ts is a
 * legacy REST surface with no caller: 14 days of production traffic and a code
 * audit (2026-11-06) found none, and company sessions were already refused by
 * tenantSurfaceGuard. Those paths answer 404 before any auth or DB work, which
 * also closes the anonymous /api/uploads static tree and the customer portal
 * login. /dev stays reachable because the dev panel refuses itself in production.
 */
const LIVE = [
  /^\/health\/?$/,
  /^\/auth(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/platform(\/|$)/,
  /^\/hr(\/|$)/,
  /^\/v1\/procurement\/contracts\/approval-authority(\/|$)/,
  /^\/dev(\/|$)/,
];

/** `path` is relative to the /api mount, e.g. `/auth/me`. */
export function isLiveApiPath(path: string): boolean {
  return LIVE.some(pattern => pattern.test(path));
}

export function liveApiSurface(req: Request, res: Response, next: NextFunction) {
  if (isLiveApiPath(req.path)) return next();
  return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
}
