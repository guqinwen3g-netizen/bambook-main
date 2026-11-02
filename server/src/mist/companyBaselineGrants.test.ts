// 公司基线种子的付款个人授权：按真实权限加载链（loadUserWithRoles → buildLoadedAuthTokenPayload →
// loadEffectivePermissionScopes）在公司会话下核对；内存库按 Prisma where 条件过滤 companyId。
import { describe, expect, it } from 'vitest';
import { getDefaultScopeListForRole, SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import type { MistCompanyRoster } from '../shared/mistCompanyBaseline';
import { companyBaselinePaymentSignerGaps, companyBaselineTargetCompany, writeCompanyBaselinePaymentGrants } from './companyBaselineGrants';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const roster: MistCompanyRoster = {
  owner: { id: 'cp-owner', name: '沈霁' }, fabricManager: { id: 'cp-fabric-manager', name: '俞宁' }, garmentManager: { id: 'cp-garment-manager', name: '陆衡' },
  fabricSales: { id: 'cp-fabric-sales', name: '沈禾' }, garmentSales: { id: 'cp-garment-sales', name: '林澈' }, finance: { id: 'cp-finance', name: '林舒' },
  fabricQc: { id: 'cp-fabric-qc', name: '唐岚' }, garmentQc: { id: 'cp-garment-qc', name: '许言' }, logistics: { id: 'cp-logistics', name: '陈晓' },
};
const role = (code: string, companyId: string | null) => ({ id: companyId ? `${code}@${companyId}` : code, companyId, code, isSystem: true, name: code, permissions: getDefaultScopeListForRole(code as any).map(scope => ({ permission: { scope } })) });

function database(companyId: string | null) {
  const roles: Record<string, string> = { [roster.owner.id]: SYSTEM_ROLE_IDS.ADMIN, [roster.fabricManager.id]: SYSTEM_ROLE_IDS.SALES_MANAGER, [roster.garmentManager.id]: SYSTEM_ROLE_IDS.SALES_MANAGER };
  const overrides: any[] = [];
  const db: any = {
    overrides,
    userAccount: { findFirst: async ({ where }: any) => roles[where.id] ? { id: where.id, displayName: where.id, status: 'active', deletedAt: null, primaryDeptId: null, primaryDepartment: null, roles: [{ roleId: role(roles[where.id], companyId).id, departmentId: null, department: null, role: role(roles[where.id], companyId) }] } : null },
    userPermissionOverrides: {
      findMany: async ({ where }: any) => overrides.filter(o => o.userId === where.userId && o.isActive && o.deletedAt === null && (!('companyId' in where) || o.companyId === where.companyId)).map(o => ({ scope: o.scope })),
      upsert: async ({ where, create, update }: any) => { const row = overrides.find(o => o.userId === where.userId_scope.userId && o.scope === where.userId_scope.scope); if (row) Object.assign(row, update); else overrides.push({ deletedAt: null, expiresAt: null, ...create }); },
    },
    companyMember: { findFirst: async ({ where }: any) => companyId && where.companyId === companyId && roles[where.userId] ? { userId: where.userId, companyId, status: 'active', company: { id: companyId, status: 'active', settings: {} } } : null },
    company: { count: async () => (companyId ? 1 : 0), findFirst: async () => (companyId ? { id: companyId } : null) },
  };
  return db;
}

describe('公司基线付款个人授权按公司会话生效', () => {
  it('目标公司取源账号角色所属公司；全局角色为 null；分属多家公司时拒绝', () => {
    expect(companyBaselineTargetCompany([{ roles: [{ role: { companyId: COMPANY } }] }, { roles: [{ role: { companyId: COMPANY } }] }])).toBe(COMPANY);
    expect(companyBaselineTargetCompany([{ roles: [{ role: { companyId: null } }] }])).toBeNull();
    expect(() => companyBaselineTargetCompany([{ roles: [{ role: { companyId: COMPANY } }] }, { roles: [{ role: { companyId: null } }] }])).toThrow('无法确定');
  });
  it('授权写成目标公司的 companyId，公司会话下签字人持有各自档位', async () => {
    const db = database(COMPANY);
    expect(await companyBaselinePaymentSignerGaps(db, roster, COMPANY)).toEqual([
      '俞宁：vouchers:approve:pay_gt5', '陆衡：vouchers:approve:pay_gt5',
    ]);
    await writeCompanyBaselinePaymentGrants(db, roster, COMPANY);
    expect(db.overrides.map((o: any) => [o.userId, o.scope, o.companyId])).toEqual([[roster.fabricManager.id, 'vouchers:approve:pay_gt5', COMPANY], [roster.garmentManager.id, 'vouchers:approve:pay_gt5', COMPANY]]);
    expect(await companyBaselinePaymentSignerGaps(db, roster, COMPANY)).toEqual([]);
  });
  it('companyId 为 null 的授权在公司会话下不生效（回归：此前写法）', async () => {
    const db = database(COMPANY);
    await writeCompanyBaselinePaymentGrants(db, roster, null);
    expect(await companyBaselinePaymentSignerGaps(db, roster, COMPANY)).toEqual(['俞宁：vouchers:approve:pay_gt5', '陆衡：vouchers:approve:pay_gt5']);
    // 重跑时把已有授权改到目标公司。
    await writeCompanyBaselinePaymentGrants(db, roster, COMPANY);
    expect(db.overrides).toHaveLength(2);
    expect(await companyBaselinePaymentSignerGaps(db, roster, COMPANY)).toEqual([]);
  });
  it('账号不是该公司在职成员时，报告无法按公司会话加载，而不是当作已持有', async () => {
    const db = database(COMPANY); await writeCompanyBaselinePaymentGrants(db, roster, COMPANY);
    db.companyMember.findFirst = async () => null;
    const gaps = await companyBaselinePaymentSignerGaps(db, roster, COMPANY);
    expect(gaps).toHaveLength(3);
    expect(gaps.every(g => g.includes('无法按公司会话加载权限'))).toBe(true);
  });
  it('未分公司的旧库：companyId 为 null 的授权照常生效', async () => {
    const db = database(null); await writeCompanyBaselinePaymentGrants(db, roster, null);
    expect(await companyBaselinePaymentSignerGaps(db, roster, null)).toEqual([]);
  });
});
