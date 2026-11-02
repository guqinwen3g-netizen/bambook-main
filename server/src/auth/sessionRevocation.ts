/** 会话撤销判定（主 API 守卫与 Mist authority 共用）。 */
import { randomUUID } from 'node:crypto';
/**
 * 「退出所有设备」/ 管理员重置密码写入 metadata.sessionsRevokedAt（ISO）。签发时间（JWT iat，秒）早于该秒的令牌一律失效；
 * 同一秒内重新登录的新令牌保留（iat 精度为秒）。Mist 服务端 authority 复用同一判定。
 */
export function sessionRevokedBeforeSec(metadata: unknown): number {
  const at = (metadata as any)?.sessionsRevokedAt;
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
export function isTokenRevoked(metadata: unknown, iat: unknown, credentialVersion?: unknown): boolean {
  const version=(metadata as any)?.credentialVersion;
  if(typeof version==='string' && version!==credentialVersion)return true;
  const before = sessionRevokedBeforeSec(metadata);
  return before > 0 && typeof iat === 'number' && iat < before;
}

/**
 * 账号停用、重新启用时写入：换新凭据代次并记下全部退出时间，此前签发的令牌一律作废。
 * 只改 status 不换代次的话，停用前签发、尚未过期的令牌会在重新启用后复活。
 */
export function revokeAllSessions(metadata: unknown, at = new Date()): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return { ...base, credentialVersion: randomUUID(), sessionsRevokedAt: at.toISOString() };
}
