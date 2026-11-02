import { SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';

/**
 * 2026-11 P0 权限码补授：已存在公司的系统岗位副本（`<code>@<companyId>`）不会随默认矩阵更新，
 * 本清单只补本次 P0 新引入、为保持原能力必须补的码；不按默认矩阵整体同步，公司有意撤销的旧权限不补回。
 * 迁移脚本：server/scripts/backfill-p0-role-permissions.ts；说明：docs/权限码迁移-退税与锁汇-2026-11.md。
 */
export const P0_ROLE_GRANTS: Readonly<Record<string, readonly string[]>> = {
  [SYSTEM_ROLE_IDS.ADMIN]: ['customs:admin'],
  [SYSTEM_ROLE_IDS.SALES]: ['tax:read'],
  [SYSTEM_ROLE_IDS.SALES_MANAGER]: ['tax:read', 'ai:write:high'],
  [SYSTEM_ROLE_IDS.LOGISTICS]: ['tax:read', 'ai:write:medium'],
  [SYSTEM_ROLE_IDS.QC]: ['ai:write:medium'],
  [SYSTEM_ROLE_IDS.FINANCE]: ['ai:write:high'],
};

/** 自定义岗位持有旧码而没有对应新码时，改码后可能丢能力，须公司管理员人工核对。 */
export const P0_REVIEW_PAIRS: ReadonlyArray<readonly [held: string, missing: string]> = [
  ['invoices:read', 'tax:read'],
  ['invoices:write', 'tax:write'],
  ['vouchers:write', 'fx:lock'],
  ['customs:write', 'customs:admin'],
];

export type BackfillRole = { id: string; code: string | null; isSystem: boolean; scopes: readonly string[] };
export type BackfillCompany = { id: string; slug: string; roles: readonly BackfillRole[] };
export type BackfillGrant = { roleId: string; roleCode: string; scope: string };
export type BackfillReview = { roleId: string; held: string; missing: string };
export type BackfillPlan = { companyId: string; slug: string; grants: BackfillGrant[]; review: BackfillReview[] };

const isSystemCopy = (role: BackfillRole, companyId: string) => !!role.code && role.isSystem && role.id === `${role.code}@${companyId}`;

/** 计算一家公司的补授计划；纯函数，已补齐时 grants 为空（幂等）。 */
export function planP0Backfill(company: BackfillCompany): BackfillPlan {
  const grants: BackfillGrant[] = [], review: BackfillReview[] = [];
  for (const role of company.roles) {
    const held = new Set(role.scopes);
    if (isSystemCopy(role, company.id)) {
      for (const scope of P0_ROLE_GRANTS[role.code!] || []) if (!held.has(scope)) grants.push({ roleId: role.id, roleCode: role.code!, scope });
      continue;
    }
    for (const [had, missing] of P0_REVIEW_PAIRS) if (held.has(had) && !held.has(missing)) review.push({ roleId: role.id, held: had, missing });
  }
  return { companyId: company.id, slug: company.slug, grants, review };
}

/** 计划的文字输出：只含公司标识、岗位码与权限码。 */
export function formatP0Plan(plan: BackfillPlan): string[] {
  const lines = [`[${plan.slug}] 补授 ${plan.grants.length} 项，需人工核对 ${plan.review.length} 项`];
  for (const g of plan.grants) lines.push(`  + ${g.roleId} ${g.scope}`);
  for (const r of plan.review) lines.push(`  ? ${r.roleId} 持 ${r.held} 无 ${r.missing}`);
  return lines;
}
