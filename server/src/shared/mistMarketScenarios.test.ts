import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';

function fixture() {
  let n = 0;
  const context: MistContext = { id: () => `scenario-${++n}`, now: '2026-10-14T02:00:00Z', actorId: 'sales', actorName: '业务员', members: [
    { id: 'sales', name: '业务员', active: true, groups: ['fabric'] },
    { id: 'peer', name: '协作人', active: true, groups: ['fabric'] },
  ] };
  let state = createMistState(context, 'empty');
  state.customers.push({ id: 'customer', name: '模拟客户', code: 'C1', country: 'CN', city: '', industry: '', owner: '业务员', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  const run = (command: MistCommand, ctx = context) => { const out = applyMistCommand(state, command, ctx); state = out.state; return out.result; };
  const product = (sku: string, customerId = 'customer', code = 'BUYER-01') => run({ type: 'market.product.save', payload: { input: {
    sku, name: '府绸', category: 'fabric', season: '', supplierId: '', supplierCode: '', composition: '', specification: '', color: '', unit: '米', cost: '1', currency: 'USD', sourceDevId: '', sourceVersionId: '', customerCodes: [{ customerId, code }],
  } } }).id!;
  const show = () => run({ type: 'market.show.save', payload: { input: { name: '面料展', location: '上海', seasonId: '', startDate: '2026-10-01', endDate: '2026-10-20', booth: '', attendees: '', cost: '100', currency: 'USD', status: 'Planned' } } }).id!;
  const lead = (parentId: string, customerId = '') => run({ type: 'market.showLead.save', payload: { input: { name: '采购', company: '模拟客户分部', email: 'buyer@example.com', phone: '', demand: '样布', source: 'show', parentId, customerId, followUpDate: '', estimatedValue: '10', actualValue: '0', currency: 'USD' } } }).id!;
  return { run, product, show, lead, context, get state() { return state; } };
}

describe('市场与资料场景回归', () => {
  it('同一客户货号不能分配给第二个产品，且失败不改写数据', () => {
    const f = fixture(); f.product('P1'); const before = structuredClone(f.state);
    expect(() => f.product('P2')).toThrow(/客户编码已存在/);
    expect(f.state).toEqual(before);
  });
  it('不同客户可以使用相同货号；原产品保留货号不与自身冲突', () => {
    const f = fixture(); const id = f.product('P1');
    f.state.customers.push({ ...f.state.customers[0], id: 'other', code: 'C2' });
    f.product('P2', 'other');
    const p = f.state.market.products.find(p => p.id === id)!;
    f.run({ type: 'market.product.save', payload: { id, input: { ...p, name: '府绸改名' } } });
    expect(f.state.market.products).toHaveLength(2);
    expect(f.state.market.products.find(p => p.id === id)!.customerCodes).toEqual([{ customerId: 'customer', code: 'BUYER-01' }]);
  });
  it('归档产品仍占用客户货号，避免历史引用歧义', () => {
    const f = fixture(); const id = f.product('P1');
    f.run({ type: 'market.product.status', payload: { id, status: 'archived' } });
    expect(() => f.product('P2')).toThrow(/客户编码已存在/);
  });
  it('已关联客户的线索转 CRM 时复用客户，不因分部名称不同新建客户', () => {
    const f = fixture(); const id = f.lead(f.show(), 'customer');
    const result = f.run({ type: 'market.lead.convertToCrm', payload: { id } });
    expect(result.customerId).toBe('customer'); expect(f.state.customers).toHaveLength(1);
    expect(() => f.run({ type: 'market.lead.convertToCrm', payload: { id } })).toThrow(/已转化/);
  });
  it('显式选择现有客户时保留同邮箱联系人，不重复建立客户与联系人', () => {
    const f = fixture();
    f.run({ type: 'market.contact.save', payload: { kind: 'customer', parentId: 'customer', name: '采购', role: '', email: 'buyer@example.com', phone: '', primary: true } });
    const contacts = structuredClone(f.state.contacts); const id = f.lead(f.show());
    f.run({ type: 'market.lead.convertToCrm', payload: { id, customerId: 'customer' } });
    expect(f.state.customers).toHaveLength(1); expect(f.state.contacts).toEqual(contacts);
    expect(f.state.market.leads.find(l => l.id === id)).toMatchObject({ status: 'Converted', customerId: 'customer' });
  });
  it('商机校验失败时客户、联系人、线索与事件均保持原状', () => {
    const f = fixture(); const id = f.lead(f.show()); const before = structuredClone(f.state);
    expect(() => f.run({ type: 'market.lead.convertToCrm', payload: { id, opportunity: { title: '', domain: 'fabric', amount: '10', currency: 'USD', expectedDate: '2026-12-01' } } })).toThrow();
    expect(f.state).toEqual(before);
  });
  it('作废展会后不能新增线索，已有线索引用的展会不能作废', () => {
    const f = fixture(); const removed = f.show();
    f.run({ type: 'market.season.void', payload: { kind: 'show', id: removed, reason: '录错' } });
    expect(() => f.lead(removed)).toThrow(/不存在/);
    const used = f.show(); f.lead(used); const before = structuredClone(f.state);
    expect(() => f.run({ type: 'market.season.void', payload: { kind: 'show', id: used, reason: '录错' } })).toThrow(/已被引用/);
    expect(f.state).toEqual(before);
  });
  it('作废季节后不能关联新趋势或展会', () => {
    const f = fixture(); const id = f.run({ type: 'market.season.save', payload: { input: { code: 'SS27', name: '春夏', startDate: '2027-01-01', endDate: '2027-06-30', milestones: [], status: 'Planning' } } }).id!;
    f.run({ type: 'market.season.void', payload: { kind: 'season', id, reason: '录错' } });
    expect(() => f.run({ type: 'market.trend.save', payload: { input: { name: '棉', type: 'fabric', seasonId: id, source: '展会', productIds: [] } } })).toThrow(/不存在/);
    expect(() => f.run({ type: 'market.show.save', payload: { input: { name: '面料展', location: '上海', seasonId: id, startDate: '2027-01-01', endDate: '2027-01-02', booth: '', attendees: '', cost: '0', currency: 'USD', status: 'Planned' } } })).toThrow(/不存在/);
  });
  it('产品导入中间行失败时整批回滚；重复编码也不能留下首行', () => {
    const f = fixture(); const before = structuredClone(f.state);
    for (const rows of [
      [{ sku: 'P1', name: '府绸', category: '面料', unit: '米' }, { sku: 'P2', name: '', category: '面料', unit: '米' }, { sku: 'P3', name: '斜纹', category: '面料', unit: '米' }],
      [{ sku: 'P1', name: '府绸', category: '面料', unit: '米' }, { sku: 'p1', name: '斜纹', category: '面料', unit: '米' }],
    ]) {
      expect(() => f.run({ type: 'market.import', payload: { kind: 'product', rows } })).toThrow();
      expect(f.state).toEqual(before);
    }
  });
  it('准备画册后产品更名不改写快照；附件替换失败不丢失旧引用', () => {
    const f = fixture(); const productId = f.product('P1');
    const id = f.run({ type: 'market.lookbook.save', payload: { input: { name: '样布册', customerId: 'customer', productIds: [productId] } } }).id!;
    f.run({ type: 'market.lookbook.status', payload: { id, status: 'Prepared' } });
    const p = f.state.market.products[0]; f.run({ type: 'market.product.save', payload: { id: productId, input: { ...p, name: '新名称' } } });
    expect(f.state.market.lookbooks[0].snapshots[0].name).toBe('府绸');
    f.run({ type: 'files.add', payload: { file: { id: 'catalog', name: 'catalog.pdf', mimeType: 'application/pdf', size: 4, storageKey: 'fixtures/catalog', createdAt: f.context.now } } });
    f.run({ type: 'market.attachment.set', payload: { kind: 'product', id: productId, fileIds: ['catalog'] } });
    expect(() => f.run({ type: 'market.attachment.set', payload: { kind: 'product', id: productId, fileIds: ['missing'] } })).toThrow(/附件不存在/);
    expect(f.state.market.products[0].fileIds).toEqual(['catalog']);
    f.run({ type: 'market.attachment.set', payload: { kind: 'product', id: productId, fileIds: [] } });
    expect(f.state.files.map(x => x.id)).toContain('catalog');
  });
});

describe('日常协作场景回归', () => {
  it('参与人编辑私人日程不能夺取所有权，也不能删除原所有人日程', () => {
    const f = fixture(); const input = { title: '周会', date: '2026-10-15', time: '09:00', note: '', personal: true, participantIds: ['peer'] };
    const id = f.run({ type: 'calendar.save', payload: input }).id!;
    const peer = { ...f.context, actorId: 'peer', actorName: '协作人' };
    f.run({ type: 'calendar.save', payload: { ...input, id, title: '周会改期' } }, peer);
    expect(f.state.calendar[0]).toMatchObject({ ownerId: 'sales', owner: '业务员' });
    expect(() => f.run({ type: 'calendar.delete', payload: { id } }, peer)).toThrow(/本人/);
  });
  it('参与人不能将他人的私人日程改为共享日程', () => {
    const f = fixture(); const input = { title: '周会', date: '2026-10-15', time: '09:00', note: '', personal: true, participantIds: ['peer'] };
    const id = f.run({ type: 'calendar.save', payload: input }).id!; const before = structuredClone(f.state);
    expect(() => f.run({ type: 'calendar.save', payload: { ...input, id, personal: false } }, { ...f.context, actorId: 'peer' })).toThrow(/本人/);
    expect(f.state).toEqual(before);
  });
  it('重复日程整体改期保留规则，非法结束日回滚，所有人可以取消重复', () => {
    const f = fixture(); const input = { title: '周会', date: '2026-10-15', time: '09:00', note: '', personal: true, repeat: { every: 'week' as const, until: '2026-11-30' } };
    const id = f.run({ type: 'calendar.save', payload: input }).id!;
    f.run({ type: 'calendar.save', payload: { id, title: input.title, date: '2026-10-16', time: '10:00', note: '' } });
    expect(f.state.calendar[0]).toMatchObject({ id, date: '2026-10-16', repeat: input.repeat });
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'calendar.save', payload: { ...input, id, date: '2026-12-01' } })).toThrow(/结束日/);
    expect(f.state).toEqual(before);
    f.run({ type: 'calendar.save', payload: { ...input, id, repeat: null } });
    expect(f.state.calendar[0].repeat).toBeUndefined();
  });
  it('通知全部已读只修改可见 ID，空可见集合不修改任何通知', () => {
    const f = fixture(); f.state.notifications.push(...['mine', 'hidden'].map(id => ({ id, title: id, detail: '', at: f.context.now, readAt: null, target: { view: 'marketing' }, category: 'general' as const })));
    f.run({ type: 'notification.readAll', payload: {} }, { ...f.context, visibleNotificationIds: [] });
    expect(f.state.notifications.every(n => n.readAt === null)).toBe(true);
    f.run({ type: 'notification.readAll', payload: {} }, { ...f.context, visibleNotificationIds: ['mine'] });
    expect(f.state.notifications.find(n => n.id === 'mine')!.readAt).toBe(f.context.now);
    expect(f.state.notifications.find(n => n.id === 'hidden')!.readAt).toBeNull();
  });
});
