import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from './service';

/** Old normalized-table modules have no tenant ownership: never expose them to company sessions. */
export function tenantSurfaceGuard(req: Request, res: Response, next: NextFunction) {
  const actor = (req as Request & { actor?: TokenPayload }).actor;
  if (actor?.platformOnly && !/^\/(auth|platform)(\/|$)/.test(req.path) && req.path !== '/health') return res.status(403).json({ ok: false, error: 'COMPANY_SELECTION_REQUIRED', message: '请先选择公司再进入业务。' });
  if (!actor?.companyId) return next();
  // 平台代管只开放公司后台（账号、加入审批、角色权限、组织与人事），不进入公司业务数据。
  if (actor.support && /^\/mist(\/|$)/.test(req.path)) return res.status(403).json({ ok: false, error: 'SUPPORT_ROUTE_UNAVAILABLE', message: '平台代管只能办理公司后台事务。' });
  const route = req.path;
  if (/^\/(auth|platform|mist)(\/|$)/.test(route) || route === '/health') return next();
  if (/^\/admin\/(users|roles|permissions)(\/|$)/.test(route)) return next();
  if (/^\/hr\/(personnel|departments|positions|teams|employees|employment-events)(\/|$)/.test(route) && !/\/(overview|grants)(\/|$)/.test(route)) return next();
  return res.status(403).json({ ok: false, error: 'TENANT_ROUTE_UNAVAILABLE', message: '此旧接口尚未支持公司隔离，请使用公司业务页面。' });
}
