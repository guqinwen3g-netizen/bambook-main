import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from './service';

/** Old normalized-table modules have no tenant ownership: never expose them to company sessions. */
export function tenantSurfaceGuard(req: Request, res: Response, next: NextFunction) {
  const actor = (req as Request & { actor?: TokenPayload }).actor;
  if (!actor?.companyId) return next();
  const route = req.path;
  if (/^\/(auth|platform|mist)(\/|$)/.test(route) || route === '/health') return next();
  if (/^\/admin\/(users|roles|permissions)(\/|$)/.test(route)) return next();
  if (/^\/hr\/(personnel|departments|positions|teams|employees)(\/|$)/.test(route) && !/\/(overview|grants)(\/|$)/.test(route)) return next();
  return res.status(403).json({ ok: false, error: 'TENANT_ROUTE_UNAVAILABLE', message: '此旧接口尚未支持公司隔离，请使用公司业务页面。' });
}
