/**
 * 登录会话有效期（2026-11 用户定案）：
 * - 勾选“保持登录”：令牌与 Cookie 30 天，使用中经 /auth/refresh 滑动续期；
 * - 不勾选：会话 Cookie（关闭浏览器即失效），令牌 12 小时，使用中同样续期；
 * - 无论是否续期，距本次密码登录超过 90 天必须重新登录，续期不能无限延长会话。
 * 续期只在当前凭据仍有效时进行：停用、改密、重置、退出所有设备后的旧令牌一律拒绝。
 */
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { TokenPayload } from './service';

export const REMEMBERED_SESSION_SECONDS = 30 * 24 * 3600;
export const BROWSER_SESSION_SECONDS = 12 * 3600;
export const MAX_SESSION_AGE_SECONDS = 90 * 24 * 3600;
export const SESSION_COOKIE = 'bambook_token';

export type SessionClaims = { remember: boolean; sessionId: string; authTime: number };
type Signer = { signToken: (payload: TokenPayload, options?: { expiresInSec?: number }) => string };

/** 新登录：开始一个新会话。 */
export function newSession(remember: boolean, now = Math.floor(Date.now() / 1000)): SessionClaims {
  return { remember, sessionId: randomUUID(), authTime: now };
}
/** 换发（续期、改密、切换公司）沿用原会话；旧格式令牌按“未保持登录”处理，登录时间取签发时间。 */
export function sessionOf(prior: TokenPayload & { iat?: number }): SessionClaims {
  const authTime = typeof prior.authTime === 'number' ? prior.authTime : typeof prior.iat === 'number' ? prior.iat : Math.floor(Date.now() / 1000);
  return { remember: prior.remember === true, sessionId: typeof prior.sessionId === 'string' && prior.sessionId ? prior.sessionId : randomUUID(), authTime };
}
/** 本会话还能再签发多久；≤0 表示已超过 90 天上限，须重新登录。 */
export function sessionLifetime(claims: SessionClaims, now = Math.floor(Date.now() / 1000)): number {
  const ttl = claims.remember ? REMEMBERED_SESSION_SECONDS : BROWSER_SESSION_SECONDS;
  return Math.min(ttl, claims.authTime + MAX_SESSION_AGE_SECONDS - now);
}
export class SessionExpiredError extends Error { constructor() { super('SESSION_MAX_AGE'); } }

/** 签发会话令牌并写 Cookie：保持登录写持久 Cookie，否则写会话 Cookie。 */
export function writeSession(res: Response, signer: Signer, payload: TokenPayload, claims: SessionClaims): string {
  const lifetime = sessionLifetime(claims);
  if (lifetime <= 0) throw new SessionExpiredError();
  const token = signer.signToken({ ...payload, ...claims }, { expiresInSec: lifetime });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(claims.remember ? { maxAge: lifetime * 1000 } : {}),
  });
  return token;
}
