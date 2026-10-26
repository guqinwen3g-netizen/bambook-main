import { isTokenRevoked } from './sessionRevocation';
import { CompanyAccessError } from './companyAccess';
import { runWithCompanyContext } from './requestCompanyContext';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from './service';
import { extractActorFromRequest } from './middleware';
import { buildLoadedAuthTokenPayload, loadUserWithRoles } from './tokenHelpers';
import { logger } from '../lib/logger';
import { httpStatusOfCode } from '../shared/errorCodes';

/**
 * Revalidate configured authorization on every authenticated API request.
 * JWT/API key authenticate the subject; a stale grant snapshot is not authority.
 * Legacy JWT format remains valid, but every authenticated subject is reloaded.
 * No cache means role withdrawal and grant expiry take effect on the next request.
 */
export function createAuthorizationSnapshotGuard(options: {
  prisma: PrismaClient;
  apiKeys?: ReadonlySet<string>;
  apiKeyActors?: ReadonlyMap<string, TokenPayload>;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (/^\/auth\/(login(?:\/mfa)?|logout|companies|switch-company|send-code|register|account-access\/(?:request|complete))\/?$/.test(req.path)) return next();
    const jwt = extractActorFromRequest(req);
    const key = req.headers['x-bambook-api-key'] || req.headers['x-api-key'] || req.query.apiKey;
    const bound = !jwt && typeof key === 'string' && options.apiKeys?.has(key)
      ? options.apiKeyActors?.get(key) : undefined;
    const prior = jwt || bound;
    if (!prior?.userId) return next();
    try {
      const user = await loadUserWithRoles(options.prisma, prior.userId);
      if (!user || user.status !== 'active' || user.deletedAt != null) {
        if (jwt) res.clearCookie('bambook_token', { path: '/' });
        return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: '账号已失效，请重新登录。' });
      }
      if(jwt && isTokenRevoked(user.metadata,(jwt as any).iat,jwt.credentialVersion))return res.status(401).json({error:'SESSION_REVOKED',message:'密码已更新，请重新登录。'});
      const platformRequest = /^\/platform(?:\/|$)/.test(req.path) && (user as any).platformRole === 'platform_admin';
      const platformCompany = jwt && !platformRequest ? jwt.platformCompany : undefined;
      const current = await buildLoadedAuthTokenPayload(options.prisma, user, platformRequest ? null : prior.companyId ?? null, platformCompany);
      // Refresh account grants without expanding the verified credential's
      // upper bound. The prior actor came from a signed JWT or configured key
      // binding; request body fields never participate in this decision.
      if (prior.permissionCeiling !== undefined) current.permissionCeiling = [...prior.permissionCeiling];
      (req as Request & { actor?: TokenPayload }).actor = current;
      (req as Request & { authSource?: string }).authSource = jwt ? 'user-session' : 'api-key';
      if (current.platformCompany && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // 平台进入公司后的变更仍使用真实平台人员身份留痕。
        const recorded = await options.prisma.auditLog.create({ data: {
          id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, actorId: user.id, action: 'platform_company_request',
          targetType: 'Company', targetId: current.platformCompany.companyId, ip: req.ip || null,
          detail: { method: req.method, path: req.path, startedAt: current.platformCompany.startedAt },
        } }).then(() => true, () => false);
        if (!recorded) return res.status(503).json({ error: 'AUDIT_UNAVAILABLE', message: '暂时无法记录管理操作，请稍后重试。' });
      }
      return runWithCompanyContext(current.companyId ?? null, () => next(), current.platformCompany);
    } catch (error) {
      if (error instanceof CompanyAccessError) return res.status(error.status).json({ error: error.code, message: error.message });
      logger.warn('[authorization] current permission load failed', {
        userId: prior.userId, error: (error as Error).message,
      });
      // Permission-loading failure never restores defaults or the stale snapshot.
      return res.status(httpStatusOfCode('AUTHORIZATION_UNAVAILABLE')).json({ error: 'AUTHORIZATION_UNAVAILABLE', message: '暂时无法核验权限，请稍后重试。' });
    }
  };
}
