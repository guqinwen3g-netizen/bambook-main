import { describe, expect, it } from 'vitest';
import { getDefaultScopeListForRole, SYSTEM_ROLE_IDS, type SystemRoleId } from '../_shared/rolePermissionMatrix';
import { formatP0Plan, P0_ROLE_GRANTS, planP0Backfill, type BackfillCompany } from './p0PermissionBackfill';

const C = 'c-1';
// 老公司：岗位副本按 P0 之前的矩阵建立（缺本次新码）；业务员有意撤销了 pricing:write。
const before = (code: SystemRoleId) => getDefaultScopeListForRole(code).filter(scope => !(P0_ROLE_GRANTS[code] || []).includes(scope));
const sys = (code: SystemRoleId, scopes = before(code)) => ({ id: `${code}@${C}`, code, isSystem: true, scopes });
const company = (): BackfillCompany => ({ id: C, slug: 'demo-co', roles: [
  sys(SYSTEM_ROLE_IDS.SUPER_ADMIN), sys(SYSTEM_ROLE_IDS.ADMIN), sys(SYSTEM_ROLE_IDS.SALES_MANAGER),
  sys(SYSTEM_ROLE_IDS.SALES, before(SYSTEM_ROLE_IDS.SALES).filter(s => s !== 'pricing:write')),
  sys(SYSTEM_ROLE_IDS.FINANCE), sys(SYSTEM_ROLE_IDS.QC), sys(SYSTEM_ROLE_IDS.LOGISTICS),
  { id: 'custom-docs', code: null, isSystem: false, scopes: ['invoices:read', 'customs:write', 'vouchers:write'] },
  { id: 'custom-ok', code: null, isSystem: false, scopes: ['invoices:read', 'tax:read'] },
  { id: 'custom-tax', code: null, isSystem: false, scopes: ['tax:read', 'tax:write', 'tax:approve', 'invoices:reconcile'] },
  { id: 'custom-tax-ok', code: null, isSystem: false, scopes: ['tax:read', 'tax:write', 'tax:approve', 'invoices:reconcile', 'sensitive:tax_base'] },
] });

describe('P0 权限码补授计划', () => {
  it('只补明确清单，不补公司有意撤销的旧权限', () => {
    const plan = planP0Backfill(company());
    expect(plan.grants.map(g => `${g.roleCode} ${g.scope}`).sort()).toEqual([
      'role-admin customs:admin', 'role-finance ai:write:high', 'role-logistics ai:write:medium', 'role-logistics tax:read',
      'role-qc ai:write:medium', 'role-sales tax:read', 'role-sales-manager ai:write:high', 'role-sales-manager tax:read',
    ]);
    expect(plan.grants.some(g => g.scope === 'pricing:write')).toBe(false);
    expect(plan.grants.every(g => g.roleId === `${g.roleCode}@${C}`)).toBe(true);
  });

  it('自定义岗位不改，只列出需人工核对的旧码 / 新码缺口', () => {
    const plan = planP0Backfill(company());
    expect(plan.grants.some(g => g.roleId.startsWith('custom'))).toBe(false);
    expect(plan.review).toEqual([
      { roleId: 'custom-docs', held: 'invoices:read', missing: 'tax:read' },
      { roleId: 'custom-docs', held: 'vouchers:write', missing: 'fx:lock' },
      { roleId: 'custom-docs', held: 'customs:write', missing: 'customs:admin' },
      { roleId: 'custom-tax', held: 'tax:write', missing: 'sensitive:tax_base' },
      { roleId: 'custom-tax', held: 'tax:approve', missing: 'sensitive:tax_base' },
      { roleId: 'custom-tax', held: 'invoices:reconcile', missing: 'sensitive:tax_base' },
    ]);
  });

  it('幂等：已补齐时计划为空；新开通公司（当前默认矩阵）也为空', () => {
    const plan = planP0Backfill(company()), done = company();
    done.roles = done.roles.map(role => ({ ...role, scopes: [...role.scopes, ...plan.grants.filter(g => g.roleId === role.id).map(g => g.scope)] }));
    expect(planP0Backfill(done).grants).toEqual([]);
    const fresh: BackfillCompany = { id: C, slug: 'new-co', roles: Object.values(SYSTEM_ROLE_IDS).map(code => sys(code, getDefaultScopeListForRole(code))) };
    expect(planP0Backfill(fresh)).toMatchObject({ grants: [], review: [] });
  });

  it('不把别家公司 id 的岗位当作本公司系统副本', () => {
    const plan = planP0Backfill({ id: C, slug: 'x', roles: [{ id: `${SYSTEM_ROLE_IDS.ADMIN}@other`, code: SYSTEM_ROLE_IDS.ADMIN, isSystem: true, scopes: [] }] });
    expect(plan.grants).toEqual([]);
  });

  it('输出只含公司标识、岗位码与权限码', () => {
    const lines = formatP0Plan(planP0Backfill(company()));
    expect(lines[0]).toBe('[demo-co] 补授 8 项，需人工核对 6 项');
    expect(lines).toContain(`  + role-admin@${C} customs:admin`);
    expect(lines).toContain('  ? custom-docs 持 customs:write 无 customs:admin');
  });
});
