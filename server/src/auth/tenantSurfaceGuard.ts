import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from './service';

/** Old normalized-table modules have no tenant ownership: never expose them to company sessions. */
export function tenantSurfaceGuard(req: Request, res: Response, next: NextFunction) {
  const actor = (req as Request & { actor?: TokenPayload }).actor;
  if (actor?.platformOnly && !/^\/(auth|platform)(\/|$)/.test(req.path) && req.path !== '/health') return res.status(403).json({ ok: false, error: 'COMPANY_SELECTION_REQUIRED', message: '请先选择公司再进入业务。' });
  if (!actor?.companyId) return next();
  // 公司设置通过平台配置接口读写；原始业务接口不作为平台后台的工作入口。
  if (actor.platformCompany && /^\/mist(\/|$)/.test(req.path)) return res.status(403).json({ ok: false, error: 'PLATFORM_COMPANY_ROUTE_UNAVAILABLE', message: '请从公司管理页面操作。' });
  const route = req.path;
  if (/^\/(auth|platform|mist)(\/|$)/.test(route) || route === '/health') return next();
  if (/^\/admin\/(users|roles|permissions)(\/|$)/.test(route)) return next();
  if (/^\/hr\/(personnel|departments|positions|teams|employees|employment-events)(\/|$)/.test(route) && !/\/(overview|grants)(\/|$)/.test(route)) return next();
  return res.status(403).json({ ok: false, error: 'TENANT_ROUTE_UNAVAILABLE', message: '此旧接口尚未支持公司隔离，请使用公司业务页面。' });
}
