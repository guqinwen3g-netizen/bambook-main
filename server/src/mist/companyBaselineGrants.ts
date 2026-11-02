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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * --apply 前的公司确认：必须显式传 --company-id，且与按源账号推断出的目标公司一致；否则拒绝（调用方在任何写入之前检查）。
 * 推断不出公司（未分公司的旧库）时同样拒绝 --apply。
 */
export function assertCompanyBaselineApplyTarget(confirmedId: string, inferredId: string | null) {
  if (!confirmedId) throw new Error('--apply 须提供 --company-id=<目标公司 uuid>，与 dry-run 输出的目标公司一致');
  if (!UUID.test(confirmedId)) throw new Error(`--company-id 不是有效的公司 uuid：${confirmedId}`);
  if (!inferredId) throw new Error('源账号没有公司角色，无法确认目标公司；拒绝写入');
  if (confirmedId.toLowerCase() !== inferredId.toLowerCase()) throw new Error(`--company-id ${confirmedId} 与源账号所属公司 ${inferredId} 不一致；拒绝写入`);
}

/**
 * 写入前核对已有的同一 (userId, scope) 授权：属于其他公司的不改归属；已撤销、已删除或已过期的不自动恢复。
 * 两种情况都拒绝，交由管理员人工处理。companyId 为 null 的旧授权视为本公司迁移前的同一授权，改到目标公司。
 */
function assertGrantReusable(row: any, companyId: string | null, label: string, now: Date) {
  if (!row) return;
  if (row.companyId !== null && row.companyId !== companyId) throw new Error(`${label} 已有属于其他公司（${row.companyId}）的同一授权，拒绝改写；请人工核对`);
  if (row.isActive === false || row.deletedAt != null) throw new Error(`${label} 的同一授权已被撤销，拒绝自动恢复；如需恢复请由管理员重新授权`);
  if (row.expiresAt != null && new Date(row.expiresAt).getTime() <= now.getTime()) throw new Error(`${label} 的同一授权已过期，拒绝自动恢复；如需恢复请由管理员重新授权`);
}

export async function writeCompanyBaselinePaymentGrants(tx: Pick<PrismaClient, 'userPermissionOverrides'>, roster: MistCompanyRoster, companyId: string | null, now = new Date()) {
  const planned = (Object.keys(MIST_COMPANY_PAYMENT_GRANTS) as MistCompanyRosterKey[]).flatMap(key => (MIST_COMPANY_PAYMENT_GRANTS[key] || []).map(scope => ({ key, scope })));
  // 先全部核对，再写入：任一行不合规就不写任何授权。
  for (const { key, scope } of planned) assertGrantReusable(await tx.userPermissionOverrides.findUnique({ where: { userId_scope: { userId: roster[key].id, scope } } }), companyId, `${roster[key].name}（${scope}）`, now);
  for (const { key, scope } of planned) {
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
