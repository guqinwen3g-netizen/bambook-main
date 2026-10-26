import type { RequestHandler } from 'express';
import type { TokenPayload } from './service';
import { publicEntryForHost, publicOriginAllowed } from '../shared/bambookPublicOrigins';

export function createPublicEntryHostGuard(surface: 'main' | 'mist' = 'main'): RequestHandler {
  return (req, res, next) => {
    // Nginx forwards the original Host. X-Forwarded-Host is never an entry authority.
    const host = String(req.headers.host ?? ''), entry = publicEntryForHost(host);
    if (!entry) return next();
    const deny = (code: string, message: string) => res.status(403).set('Cache-Control', 'no-store').json({ ok: false, error: code, message });
    if (!publicOriginAllowed(host, req.headers.origin)) return deny('PUBLIC_ORIGIN_DENIED', '请从当前入口操作。');
    if (req.path === '/health' || req.path === '/mist/session' || req.path === '/auth/logout') return next();
    const actor = (req as typeof req & { actor?: TokenPayload }).actor;
    if (entry === 'company') {
      if (/^\/platform(?:\/|$)/.test(req.path) || actor?.platformOnly || actor?.support) return deny('PLATFORM_ENTRY_ONLY', '请从平台管理入口操作。');
    } else {
      if (surface === 'mist') {
        if (/^\/ai\/platform-model(?:\/|$)/.test(req.path) && actor?.platformOnly && !actor.support) return next();
        return deny('COMPANY_ENTRY_ONLY', '请从公司入口操作。');
      }
      if (!/^\/(auth|platform|admin|hr)(?:\/|$)/.test(req.path)) return deny('COMPANY_ENTRY_ONLY', '请从公司入口操作。');
      if (/^\/auth\/(register|send-code)(?:\/|$)/.test(req.path)) return deny('COMPANY_ENTRY_ONLY', '请从公司入口注册。');
      if (actor && !actor.platformOnly && !actor.support) return deny('COMPANY_ENTRY_ONLY', '请从公司入口操作。');
    }
    next();
  };
}
