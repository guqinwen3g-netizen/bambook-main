import { validateCompanySession } from './companyAccess';
import { departmentAuthorization } from './departmentAuthorization';
import { PrismaClient } from '@prisma/client';
import { AgentRole } from '../agent/types';
import { ROLE_ID_TO_LEGACY_AGENT_ROLE, legacyAgentRoleForId, loadEffectivePermissionScopes } from './permissionService';
import { currentCompanyId } from './requestCompanyContext';
import type { TokenPayload } from './service';

/**
 * 登录 token 构造的单一事实来源（single source of truth）。
 * 登录路由与开发调试面板（一键切换账号）都必须走这里，
 * 确保两者签发的 token payload 完全一致，权限守卫不会因来源不同而放行/拒绝差异。
 */

export function userRolesToLegacyAgentRoles(
  userRoles: Array<{ roleId: string; role?: { name?: string | null; isSystem?: boolean | null; code?: string | null } }>,
): { legacy: AgentRole[]; newRoleIds: string[] } {
  const legacy = new Set<AgentRole>();
  const newRoleIds: string[] = [];
  for (const ur of userRoles) {
    if (!ur.roleId) continue;
    newRoleIds.push(ur.roleId);
    // 多租户下每家公司的系统角色各有自己的 id，按角色码（code）识别角色类型；
    // 历史全局角色没有 code，回退用 id 判断。
    const roleKey = ur.role?.code || ur.roleId;
    const mapped = legacyAgentRoleForId(roleKey);
    if (mapped) {
      // 'owner' 同时包含 owner + admin（owner 级权限应该同时拥有 admin 范围的检查）
      legacy.add(mapped);
      if (mapped === 'owner' && ROLE_ID_TO_LEGACY_AGENT_ROLE[roleKey]) legacy.add('admin');
      if (mapped === 'finance') legacy.add('finance');
    }
  }
  return { legacy: Array.from(legacy), newRoleIds };
}

export function collectPermissionScopes(roles: Array<{ role?: { permissions?: Array<{ permission?: { scope?: string | null } }> } }>): string[] {
  const scopes = new Set<string>();
  for (const userRole of roles) {
    for (const rolePermission of userRole.role?.permissions || []) {
      const scope = rolePermission.permission?.scope;
      if (scope) scopes.add(scope);
    }
  }
  return Array.from(scopes).sort();
}

export function serializeAuthUser(user: any, roles: AgentRole[], permissions: string[], departmentIds: string[], extra?: { newRoleIds?: string[]; authorizationLoaded?: true; permissionCeiling?: string[] }) {
  const assignedCompany = (user.roles || []).find((r: any) => extra?.newRoleIds?.includes(r.roleId))?.role?.companyId;
  user = companyScopedUser(user, assignedCompany);
  // Display metadata comes only from this user's current loaded role tree.
  const roleLabels = Array.from(new Set(extra?.newRoleIds || [])).flatMap(id => {
    const assigned = (user.roles || []).find((entry: any) => entry.roleId === id);
    const name = assigned?.role?.name;
    return typeof name === 'string' && name.trim() ? [{ id, name }] : [];
  });
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: (user as any).avatarUrl || null,
    platformRole: user.platformRole ?? null,
    roles,
    roleIds: extra?.newRoleIds || [],
    roleLabels,
    ...(extra?.permissionCeiling !== undefined ? { permissionCeiling: [...extra.permissionCeiling] } : {}),
    ...(extra?.authorizationLoaded === true ? { authorizationLoaded: true } : {}),
    departmentIds: departmentIds.length ? departmentIds : [user.primaryDeptId || 'company'],
    department: user.primaryDepartment?.name || null,
    // 管理员重置密码后，本人改密前前端须先引导修改（标记由 /auth/change-password 清除）。
    ...((user.metadata as any)?.forceChangePassword === true ? { mustChangePassword: true } : {}),
    ...departmentAuthorization(user, extra?.newRoleIds || [], permissions),
  };
}

/** 按 id 加载带角色/权限树的用户（与登录路由 include 完全一致）。 */
export async function loadUserWithRoles(prisma: PrismaClient, userId: string) {
  return prisma.userAccount.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      roles: { include: { department: true, role: { include: { permissions: { include: { permission: true } } } } } },
      primaryDepartment: true,
    },
  });
}

/** Project department metadata from the same company as the loaded role grant. */
export function companyScopedUser(user: any, companyId?: string | null) {
  if (!companyId) return user;
  const roles = (user.roles || []).filter((r: any) => r.role?.companyId === companyId);
  const department = roles.find((r: any) => r.department?.companyId === companyId)?.department
    ?? (user.primaryDepartment?.companyId === companyId ? user.primaryDepartment : null);
  return { ...user, roles, primaryDepartment: department, primaryDeptId: department?.id ?? null };
}

/** Compatibility projection only; it cannot certify a current DB grant load. */
export function buildAuthTokenPayload(user: any, companyId?: string | null): TokenPayload {
  // 指定公司时只取该公司的角色；公司维度为空即无权限（fail closed），
  // 避免跨公司串用角色。未指定公司（历史会话 / 未迁移数据）保持原行为。
  const scopedRoles = companyId
    ? (user.roles || []).filter((ur: any) => (ur.role?.companyId ?? null) === companyId)
    : (user.roles || []);
  const { legacy: roles, newRoleIds } = userRolesToLegacyAgentRoles(
    scopedRoles.map((ur: any) => ({ roleId: ur.roleId, role: ur.role })),
  );
  const permissions = collectPermissionScopes(scopedRoles);
  const departmentIds = scopedRoles.map((ur: any) => ur.departmentId).filter(Boolean) as string[];
  return {
    userId: user.id,
    ...(companyId ? { companyId } : {}),
    displayName: user.displayName,
    roles,
    roleIds: newRoleIds,
    permissions,
    departmentIds: departmentIds.length ? departmentIds : [user.primaryDeptId || 'company'],
  };
}

/**
 * Runtime login/me/refresh/dev-login builder. The user MUST come from a current
 * DB query with roles -> role -> permissions -> permission included. Only after
 * the additional personal-grant query succeeds do we stamp a loaded snapshot.
 */
export async function buildLoadedAuthTokenPayload(prisma: PrismaClient, user: any, companyId?: string | null): Promise<TokenPayload> {
  if (user.status !== 'active' || user.deletedAt != null) throw new Error('AUTHORIZATION_ACCOUNT_INACTIVE');
  if (!Array.isArray(user.roles) || user.roles.some((ur: any) => !Array.isArray(ur.role?.permissions))) {
    throw new Error('AUTHORIZATION_ROLE_TREE_NOT_LOADED');
  }
  // 未显式指定公司时沿用请求级会话公司，避免各处重载把别家公司的角色也算进来。
  const scopedCompany = companyId !== undefined ? companyId : currentCompanyId();
  await validateCompanySession(prisma, user, scopedCompany);
  const payload = buildAuthTokenPayload(!scopedCompany && user.platformRole === 'platform_admin' ? { ...user, roles: [] } : user, scopedCompany);
  user = companyScopedUser(user, scopedCompany);
  const permissions = await loadEffectivePermissionScopes(prisma, user.id, payload.permissions, scopedCompany);
  return { ...payload, ...departmentAuthorization(user, payload.roleIds || [], permissions), authorizationLoaded: true };
}
