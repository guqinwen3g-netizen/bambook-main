import type { TokenPayload } from '../auth/service';
import type { MistState, MistWorkspaceMember } from '../shared/mistWorkspace';
import { hasScope } from '../auth/permissionService';
import { fail } from './errors';
import { getDataScopeRule, SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import type { MistDataScope } from '../shared/mistDataScope';

/**
 * 一家公司 = 一个业务库（公司-部门-小组与数据范围 R1/R2）。
 * 公司库没有个人空间、没有切换、没有回收站；进入资格只看当前公司的在职成员身份（由 freshMistAuthority 校验），
 * 不再看库所有者或 memberIds 授权名单。本机演示模式（mistLocal）维持原有个人空间行为。
 */
export const localMode = (actor: TokenPayload) => (actor as any).mistLocal === true && process.env.MIST_LOCAL_WORKSPACE === '1' && process.env.NODE_ENV !== 'production';
export const companyLibrary = (actor: TokenPayload) => !!actor.companyId && !localMode(actor);
export const companyRow = (row: { companyId?: string | null }) => !!row.companyId;
export const companySlug = (companyId: string) => `company@${companyId}`;
/** 公司库的公司设置、业务组划分等无业务权限点的维护动作：须有公司用户管理权限（管理员 / 老板），不看是否为库创建人。 */
export const COMPANY_MAINTAIN_SCOPE = 'users:write';
export const canMaintainCompany = (actor: TokenPayload) => hasScope(actor, COMPANY_MAINTAIN_SCOPE as any);
export function singleLibrary(): never { fail('COMPANY_SINGLE_LIBRARY', '一家公司只有一个业务库：不能另建、移入回收站或单独授权成员；成员随公司在职身份自动进入', 409); }

export type CompanyRosterEntry = { userId: string; name: string; joinedAt: string };
/** 当前公司在职成员名册（公司成员 active 且账号 active、未删除）。缺少公司成员表的隔离适配器失败关闭为空名册。 */
export async function companyRoster(db: any, companyId: string): Promise<CompanyRosterEntry[]> {
  if (typeof db.companyMember?.findMany !== 'function') return [];
  const rows: any[] = await db.companyMember.findMany({
    where: { companyId, status: 'active', user: { status: 'active', deletedAt: null } },
    select: { userId: true, joinedAt: true, createdAt: true, user: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(row => ({ userId: row.userId, name: row.user?.displayName || row.userId, joinedAt: new Date(row.joinedAt ?? row.createdAt ?? 0).toISOString() }));
}
/**
 * 把公司名册覆盖到本次读取的库状态上（只在内存中）：成员目录、负责人选择、审批候选都以公司在职成员为准，
 * 已离职的库创建人不再出现。历史 memberIds/members 授权名单在公司库中不再生效。
 */
export function applyRoster(state: MistState, roster: CompanyRosterEntry[]) {
  state.memberIds = roster.map(entry => entry.userId);
  state.members = roster.map((entry): MistWorkspaceMember => ({ userId: entry.userId, name: entry.name, addedBy: 'company', addedByName: '公司成员', addedAt: entry.joinedAt }));
}

/** 本公司在用的人事小组（小组经部门归属公司）；非公司库（本机演示）没有人事小组。 */
export async function companyTeams(db: any, companyId: string | null | undefined): Promise<Array<{ id: string; name: string }>> {
  if (!companyId || typeof db.team?.findMany !== 'function') return [];
  const rows: any[] = await db.team.findMany({ where: { deletedAt: null, status: 'active', department: { companyId } }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  return rows.map(row => ({ id: row.id, name: row.name }));
}

/**
 * 岗位为全公司范围：超级管理员 / 老板，或任一岗位在业务数据上为全公司（管理员、财务、QC、后勤，见 DEFAULT_DATA_SCOPE_BY_ROLE）。
 * 业务员、业务主管与自定义岗位按行级范围（本人 ∪ 部门领导所辖 ∪ 小组）裁剪。
 */
export function companyWideActor(actor: TokenPayload) {
  if (actor.globalBusinessScope === true || actor.roles?.some(role => role === 'owner' || (role as string) === SYSTEM_ROLE_IDS.SUPER_ADMIN)) return true;
  return (actor.roleIds ?? []).some(id => getDataScopeRule(id, 'orders').kind === 'all');
}
/**
 * 受限账号的行级范围：本人 + 作为部门负责人所辖部门（含下级部门）的在职成员；本人所在的在用小组。
 * 返回 undefined 表示不裁剪（非公司库、本机演示、全公司岗位）。查询失败按异常抛出，不放宽。
 */
export async function companyDataScope(db: any, row: { companyId?: string | null; state: MistState }, actor: TokenPayload): Promise<MistDataScope | undefined> {
  if (!row.companyId || localMode(actor) || companyWideActor(actor)) return undefined;
  const companyId = row.companyId, userIds = new Set([actor.userId]), teamIds: string[] = [];
  if (typeof db.teamMember?.findMany === 'function') for (const m of await db.teamMember.findMany({ where: { userId: actor.userId, leftAt: null, team: { deletedAt: null, status: 'active', department: { companyId } } }, select: { teamId: true } })) teamIds.push(m.teamId);
  if (typeof db.department?.findMany === 'function') {
    const departments: Array<{ id: string; parentId: string | null; headId: string | null }> = await db.department.findMany({ where: { companyId, status: 'active' }, select: { id: true, parentId: true, headId: true } });
    const led = new Set(departments.filter(d => d.headId === actor.userId).map(d => d.id));
    for (let grew = true; grew;) { grew = false; for (const d of departments) if (d.parentId && led.has(d.parentId) && !led.has(d.id)) { led.add(d.id); grew = true; } }
    if (led.size && typeof db.userAccount?.findMany === 'function') {
      const roster = new Set(Array.isArray(row.state.memberIds) ? row.state.memberIds : []);
      for (const user of await db.userAccount.findMany({ where: { OR: [{ primaryDeptId: { in: [...led] } }, { roles: { some: { departmentId: { in: [...led] } } } }] }, select: { id: true } })) if (roster.has(user.id)) userIds.add(user.id);
    }
  }
  return { userIds: [...userIds], teamIds };
}
