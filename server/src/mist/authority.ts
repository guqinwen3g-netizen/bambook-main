import type { TokenPayload } from '../auth/service';
import { buildLoadedAuthTokenPayload, loadUserWithRoles } from '../auth/tokenHelpers';
import { hasScope } from '../auth/permissionService';
import { fail } from './errors';
import { isTokenRevoked } from '../auth/sessionRevocation';
/** 会话对应的账号当前仍可使用：在用、令牌未被撤销、无待办的强制改密。Mist 全部本人会话路由（含平台管理）共用此判定。 */
export function assertCurrentAccount(user: { status?: string; deletedAt?: unknown; metadata?: unknown } | null | undefined, prior: TokenPayload): void {
  if (!user || user.status !== 'active' || user.deletedAt != null) fail('ACCOUNT_DISABLED', '账号已失效，请重新登录', 401);
  if (isTokenRevoked(user.metadata, (prior as any).iat, prior.credentialVersion)) fail('SESSION_REVOKED', '登录已在所有设备退出，请重新登录', 401);
  // 首次登录 / 管理员重置后须本人先改密：初始或临时密码他人知道，不能凭它办理业务。
  const metadata = user.metadata as any;
  if (metadata?.forceChangePassword === true) fail('PASSWORD_CHANGE_REQUIRED', ['initial', 'invite'].includes(metadata?.forceChangeReason) ? '首次登录请先修改初始密码。' : '管理员已重置你的密码，请先修改登录密码。', 403);
}
export type FreshAuthority = (db: any, prior: TokenPayload, permission?: string | null) => Promise<TokenPayload>;
/** Always reload the real account and effective grants in the current transaction. */
export const freshMistAuthority: FreshAuthority = async (db, prior, permission) => {
  if (!prior?.userId || (prior as any).kind === 'customer') fail('UNAUTHORIZED', '请使用有效员工账号登录', 401);
  const user = await loadUserWithRoles(db, prior.userId);
  assertCurrentAccount(user, prior);
  if ((user as any).platformRole === 'platform_admin') fail('COMPANY_SELECTION_REQUIRED', '请先选择公司再进入业务。', 403);
  // 必须沿用会话所属公司：否则重新加载会把该账号在别家公司的角色也算进来。
  const current = await buildLoadedAuthTokenPayload(db, user, prior.companyId ?? null);
  if (prior.permissionCeiling !== undefined) current.permissionCeiling = [...prior.permissionCeiling];
  if (permission && !hasScope(current, permission as any)) fail('FORBIDDEN', '当前账号没有执行此操作的权限', 403);
  return current;
};
