import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildLoadedAuthTokenPayload, loadUserWithRoles } from '../auth/tokenHelpers';
import { MIST_COMPANY_PAYMENT_GRANTS, MIST_COMPANY_PAYMENT_SIGNER_SCOPES, type MistCompanyRoster, type MistCompanyRosterKey } from '../shared/mistCompanyBaseline';

/**
 * 公司基线种子的目标公司：取源账号角色所属公司（公司角色 id 形如 `<code>@<companyId>`）。
 * 全部是历史全局角色时返回 null（未分公司的旧库，权限加载不按公司过滤）；分属多家公司时拒绝，不猜。
 */
export function companyBaselineTargetCompany(sources: Array<{ roles: Array<{ role?: { companyId?: string | null } | null }> }>): string | null {
  const ids = new Set(sources.flatMap(source => source.roles.map(row => row.role?.companyId ?? null)));
  if (ids.size > 1) throw new Error('源账号的角色分属不同公司或混有全局角色，无法确定公司基线的目标公司');
  return [...ids][0] ?? null;
}

/**
 * 两位事业部经理的 >5 万档个人授权（总监级审批人）。授权须写成目标公司的 companyId：
 * 公司会话里 loadEffectivePermissionScopes 只加载 companyId 等于会话公司的个人授权，写成 null 不会生效。
 */
export async function writeCompanyBaselinePaymentGrants(tx: Pick<PrismaClient, 'userPermissionOverrides'>, roster: MistCompanyRoster, companyId: string | null) {
  for (const key of Object.keys(MIST_COMPANY_PAYMENT_GRANTS) as MistCompanyRosterKey[]) for (const scope of MIST_COMPANY_PAYMENT_GRANTS[key] || []) {
    const userId = roster[key].id;
    await tx.userPermissionOverrides.upsert({
      where: { userId_scope: { userId, scope } },
      create: { id: `UPO__${randomUUID()}`, userId, scope, companyId, grantedBy: roster.owner.id, reason: '事业部经理兼任 5 万元以上付款审批（总监级）', isActive: true },
      update: { companyId, grantedBy: roster.owner.id, isActive: true, deletedAt: null, expiresAt: null },
    });
  }
}

/** 按“该公司会话”实际加载出的权限核对每位历史付款签字人：返回缺少的权限（空数组即全部持有）。 */
export async function companyBaselinePaymentSignerGaps(db: PrismaClient, roster: MistCompanyRoster, companyId: string | null): Promise<string[]> {
  const gaps: string[] = [];
  for (const key of Object.keys(MIST_COMPANY_PAYMENT_SIGNER_SCOPES) as MistCompanyRosterKey[]) {
    const need = MIST_COMPANY_PAYMENT_SIGNER_SCOPES[key] || [], person = roster[key];
    let held: string[] = [];
    try {
      const user = await loadUserWithRoles(db, person.id);
      if (user) held = (await buildLoadedAuthTokenPayload(db, user, companyId)).permissions;
    } catch (error) { gaps.push(`${person.name}：无法按公司会话加载权限（${error instanceof Error ? error.message : String(error)}）`); continue; }
    const missing = need.filter(scope => !held.includes(scope));
    if (missing.length) gaps.push(`${person.name}：${missing.join('、')}`);
  }
  return gaps;
}
