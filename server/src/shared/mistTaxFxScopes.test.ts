import { describe, expect, it } from 'vitest';
import { mistCommandPermission, type MistCommand } from './mistWorkspace';
import { DEFAULT_ROLE_PERMISSION_MATRIX, SYSTEM_ROLE_IDS } from '../_shared/rolePermissionMatrix';
import { MIST_READ_SECTIONS } from '../mist/access';
/**
 * 2026-11 用户定案：退税改用 tax:*，锁汇改用 fx:lock；岗位默认矩阵保证财务岗原本能做的仍能做。
 * 迁移说明见 docs/权限码迁移-退税与锁汇-2026-11.md。
 */
const perm = (type: string) => mistCommandPermission({ type, payload: {} } as unknown as MistCommand);
describe('退税命令改用 tax:*', () => {
  it('登记退税率、申报、撤回用 tax:write；税务核准用 tax:approve；到账勾稽仍是核销', () => {
    for (const type of ['rebate.rate.save', 'rebate.rate.void', 'rebate.claim.file', 'rebate.claim.withdraw']) expect([type, perm(type)]).toEqual([type, 'tax:write']);
    expect(perm('rebate.claim.approve')).toBe('tax:approve');
    for (const type of ['rebate.claim.receive', 'rebate.claim.reverseReceipt']) expect([type, perm(type)]).toEqual([type, 'invoices:reconcile']);
  });
  it('退税记录按 tax:read 投影', () => {
    expect(MIST_READ_SECTIONS.find(s => s.key === 'exportRebate')!.permissions).toEqual(['tax:read']);
  });
});
describe('锁汇改用 fx:lock', () => {
  it('finance.fx.lock 用 fx:lock；结汇、分配、冲回仍是凭证写', () => {
    expect(perm('finance.fx.lock')).toBe('fx:lock');
    for (const type of ['finance.fx.settle', 'finance.fx.allocate', 'finance.fx.reverse']) expect([type, perm(type)]).toEqual([type, 'vouchers:write']);
  });
});
describe('岗位默认矩阵：财务岗仍能办退税与锁汇', () => {
  const finance = DEFAULT_ROLE_PERMISSION_MATRIX[SYSTEM_ROLE_IDS.FINANCE];
  it.each(['tax:read', 'tax:write', 'tax:approve', 'fx:lock', 'invoices:reconcile'] as const)('财务岗持有 %s', scope => { expect(finance[scope]).toBe(true); });
  it('业务员岗原先没有退税写入，改码后同样没有', () => {
    const sales = DEFAULT_ROLE_PERMISSION_MATRIX[SYSTEM_ROLE_IDS.SALES];
    for (const scope of ['tax:write', 'tax:approve', 'fx:lock'] as const) expect(sales[scope]).toBeUndefined();
  });
});

import { createMistState } from './mistWorkspace';
import { projectState } from '../mist/access';
describe('sensitive:tax_base 掩码', () => {
  const state = createMistState({ id: () => Math.random().toString(36).slice(2), now: '2026-10-14T02:00:00.000Z', actorName: 't', actorId: 't' }, 'demo');
  state.exportRebate = { rates: [], claims: [{ id: 'rc', code: 'RC-1', taxable: 100000, expected: 13000, lines: [{ billId: 'b', billCode: 'AP', invoiceNo: '1', supplier: 's', invoiceDate: '2026-10-01', taxable: 100000, rebate: 13000, inputTaxCap: 13000, parts: [] }] } as any] };
  const reader = (extra: string[]) => ({ userId: 'r', roles: [], departmentIds: [], authorizationLoaded: true, permissions: ['invoices:read', 'vouchers:read', 'tax:read', ...extra] } as any);
  const empty = () => createMistState({ id: () => 'x', now: '2026-10-14T02:00:00.000Z', actorName: 't' }, 'empty');
  it('没有 sensitive:tax_base：专票税额、退税计税金额与应退税额都不下发', () => {
    const out = projectState(state, reader([]), empty).state;
    expect(state.payables!.bills.some(b => b.taxAmount > 0)).toBe(true);
    expect(out.payables!.bills.every(b => b.taxAmount === 0 && b.taxMasked)).toBe(true);
    const claim = out.exportRebate!.claims[0];
    expect(claim).toMatchObject({ taxable: 0, expected: 0, taxMasked: true });
    expect(claim.lines[0]).toMatchObject({ taxable: 0, rebate: 0 }); expect(claim.lines[0].inputTaxCap).toBeUndefined();
    expect(JSON.stringify(out.exportRebate)).not.toContain('13000');
    expect(state.exportRebate!.claims[0].taxable).toBe(100000);
  });
  it('持有 sensitive:tax_base：原值可见', () => {
    const out = projectState(state, reader(['sensitive:tax_base']), empty).state;
    expect(out.exportRebate!.claims[0]).toMatchObject({ taxable: 100000, expected: 13000 }); expect(out.exportRebate!.claims[0].taxMasked).toBeUndefined();
    expect(out.payables!.bills.find(b => b.taxAmount > 0)).toBeTruthy();
  });
});

import { marketCommandExtraPermissions } from './mistMarket';
describe('报价转订单：quotations:convert', () => {
  it('Mist 转单在 orders:write 主门禁之外追加 quotations:convert；其他报价命令不受影响', () => {
    expect(perm('market.quotation.convert')).toBe('orders:write');
    expect(marketCommandExtraPermissions({ type: 'market.quotation.convert' })).toEqual(['quotations:convert']);
    expect(marketCommandExtraPermissions({ type: 'market.quotation.skipLines' })).toEqual([]);
    expect(marketCommandExtraPermissions({ type: 'market.quotation.save' })).toEqual([]);
  });
  it('业务员与销售主管默认持有 quotations:convert，原本能转单的岗位仍能转单', () => {
    for (const role of [SYSTEM_ROLE_IDS.SALES, SYSTEM_ROLE_IDS.SALES_MANAGER]) expect(DEFAULT_ROLE_PERMISSION_MATRIX[role]['quotations:convert']).toBe(true);
  });
});
