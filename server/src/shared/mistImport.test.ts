import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { MIST_DEMO_ACCOUNTS } from './mistAccounts';
import { mistImportHeaderKey } from './mistImport';

function fixture() {
  let i = 0; const ctx = { id: () => `im-${++i}`, now: '2026-10-18T02:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext;
  let state = createMistState(ctx, 'empty');
  const run = (kind: string, rows: Array<Record<string, string>>) => { const r = applyMistCommand(state, { type: 'market.import', payload: { kind, rows } } as MistCommand, ctx); state = r.state; return r.result as { imported: number }; };
  return { run, get state() { return state as MistState & { market: any }; } };
}

describe('基础资料批量导入', () => {
  it('权限按导入类型；表头可用中文名并忽略星号与括号说明', () => {
    expect(mistCommandPermission({ type: 'market.import', payload: { kind: 'customer', rows: [] } } as MistCommand)).toBe('relations:write');
    expect(mistCommandPermission({ type: 'market.import', payload: { kind: 'supplier', rows: [] } } as MistCommand)).toBe('suppliers:write');
    expect(mistCommandPermission({ type: 'market.import', payload: { kind: 'product', rows: [] } } as MistCommand)).toBe('products:write');
    expect(() => mistCommandPermission({ type: 'market.import', payload: { kind: 'order', rows: [] } } as MistCommand)).toThrow('导入类型无效');
    expect(mistImportHeaderKey('customer', '客户名称*')).toBe('name');
    expect(mistImportHeaderKey('customer', '信用额度（数字，留空为 0）')).toBe('creditLimit');
    expect(mistImportHeaderKey('customer', '无关列')).toBeUndefined();
  });
  it('客户：自动编码、客户经理按姓名、联系人一并建立', () => {
    const f = fixture();
    expect(f.run('customer', [
      { name: 'Nordic Wear AB', currency: 'usd', owner: '顾言', creditLimit: '50,000', since: '2023/3/1', incoterm: 'fob', contactName: 'Anna', contactEmail: 'anna@nordic.se' },
      { name: '博远纺织', currency: 'CNY', code: 'C-BY' },
    ])).toEqual({ imported: 2 });
    const [a, b] = f.state.customers;
    expect(a).toMatchObject({ name: 'Nordic Wear AB', currency: 'USD', owner: '顾言', ownerId: 'demo-sales', creditLimit: 50000, since: '2023-03-01', incoterm: 'FOB' });
    expect(a.code).toMatch(/^CUS-2026-/);
    expect(b).toMatchObject({ code: 'C-BY', ownerId: 'demo-reviewer' });
    expect(f.state.contacts.find(c => c.customerId === a.id)).toMatchObject({ name: 'Anna', email: 'anna@nordic.se' });
  });
  it('任何一行不通过则整批不导入，并逐行列出原因（含文件内重复编码）', () => {
    const f = fixture();
    let message = '';
    try { f.run('customer', [
      { name: 'A', currency: 'USD', code: 'X1' },
      { name: '', currency: 'USD' },
      { name: 'B', currency: 'USD', code: 'X1' },
      { name: 'C', currency: 'USD', owner: '不存在的人' },
      { name: 'D', currency: 'USD', contactEmail: 'd@x.com' },
    ]); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('共 4 行不通过');
    expect(message).toContain('第 3 行：客户名称未填写');
    expect(message).toContain('第 4 行：客户编码已存在');
    expect(message).toContain('第 5 行：客户经理“不存在的人”不是本工作区成员');
    expect(message).toContain('第 6 行：填写了联系方式但缺少联系人姓名');
    expect(f.state.customers).toHaveLength(0);
  });
  it('供应商与产品：产品按供应商编码或名称关联，类别用中文', () => {
    const f = fixture();
    f.run('supplier', [{ code: 'SUP-001', name: '江南成衣厂', type: '成衣', capabilities: '梭织外套', capacity: '20000', capacityUnit: '件/月', leadDays: '45', contactName: '王厂长', contactPhone: '138' }]);
    const supplier = f.state.market.suppliers[0];
    expect(supplier).toMatchObject({ code: 'SUP-001', capacity: 20000, leadDays: 45, status: 'active' });
    expect(supplier.contacts[0]).toMatchObject({ name: '王厂长', primary: true });
    f.run('product', [
      { sku: 'FB-1', name: '府绸', category: '面料', unit: '米', supplier: 'sup-001', cost: '18.5' },
      { sku: 'TR-1', name: '纽扣', category: '辅料', unit: '粒', supplier: '江南成衣厂' },
    ]);
    expect(f.state.market.products.map((p: any) => [p.sku, p.category, p.supplierId, p.cost, p.currency]).sort()).toEqual([['FB-1', 'fabric', supplier.id, '18.5', 'CNY'], ['TR-1', 'trimming', supplier.id, '0', 'CNY']]);
    expect(() => f.run('product', [{ sku: 'X', name: 'x', category: '鞋', unit: '双' }])).toThrow('类别须为');
    expect(() => f.run('product', [{ sku: 'Y', name: 'y', category: '成衣', unit: '件', supplier: '无此厂' }])).toThrow('请先导入供应商');
    expect(() => f.run('supplier', [{ code: 'S2', name: 'n', type: 't', capabilities: 'c', capacityUnit: 'u', leadDays: '3' }])).toThrow('月产能未填写');
  });
  it('空表与超量拒绝', () => {
    const f = fixture();
    expect(() => f.run('customer', [])).toThrow('没有数据行');
    expect(() => f.run('customer', Array.from({ length: 1001 }, () => ({ name: 'x', currency: 'USD' })))).toThrow('一次最多导入 1000 行');
  });
});
