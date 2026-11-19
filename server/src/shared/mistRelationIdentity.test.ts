import { describe, expect, it } from 'vitest';
import { applyMarketCommand, type MarketCommand, type MarketRelation } from './mistMarket';
import { createMistState, type MistContext } from './mistWorkspace';

function fixture() {
  let n = 0;
  const ctx: MistContext = { id: () => `identity-${++n}`, now: '2026-11-18T04:00:00.000Z', actorName: '业务员', actorId: 'sales', can: () => true, members: [{ id: 'sales', name: '业务员', active: true, groups: ['fabric', 'garment'] }], authority: { supplier: {}, businessReviewerId: 'leader' } };
  const state = createMistState(ctx, 'empty');
  const run = (command: MarketCommand) => applyMarketCommand(state, command, ctx);
  state.customers.push({ id: 'customer', name: '客户公司', code: 'C', country: '中国', city: '苏州', industry: '', owner: '业务员', ownerId: 'sales', grade: '', currency: 'CNY', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  for (const id of ['customer-file', 'supplier-file', 'shared-file', 'new-file']) state.files.push({ id, name: `${id}.txt`, mimeType: 'text/plain', size: 1, storageKey: id, createdAt: ctx.now });
  const supplierId = run({ type: 'market.supplier.save', payload: { input: { name: '供方公司', type: '服务商', country: '中国', address: '宁波', capabilities: '单证服务', capacity: 0, capacityUnit: '', leadDays: 0, note: '供应商基本资料', fileIds: [] } } }).id!;
  const supplierRelation = state.market.relations.find(r => r.supplierId === supplierId)!;
  const customerId = run({ type: 'market.relation.save', payload: { input: { name: '', category: 'Customer', customerId: 'customer', supplierId: '', country: '中国', address: '苏州', aliases: ['客户简称', '共同简称'], note: '客户偏好', fileIds: ['customer-file', 'shared-file'] } } }).id!;
  run({ type: 'market.relation.save', payload: { id: supplierRelation.id, input: { name: '', category: 'Supplier', customerId: '', supplierId, country: '中国', address: '宁波', aliases: ['供方简称', '共同简称'], note: '供方独立偏好', fileIds: ['supplier-file', 'shared-file'] } } });
  const source = structuredClone(state.market.relations.find(r => r.id === supplierRelation.id)!);
  const customer = () => state.market.relations.find(r => r.id === customerId)!;
  const split = () => { const id = run({ type: 'market.relation.unlinkSupplier', payload: { id: customerId, reason: '分别维护双方资料' } }).id!; return state.market.relations.find(r => r.id === id)!; };
  return { ctx, state, run, supplierId, source, customerId, customer, split };
}

describe('organization identity provenance and split', () => {
  it.each(['customer', 'supplier'] as const)('restores original supplier metadata and keeps customer-specific files separate (%s side link)', side => {
    const f = fixture(), originals = structuredClone(f.state.files);
    if (side === 'customer') f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    else f.run({ type: 'market.relation.linkCustomer', payload: { id: f.source.id, customerId: 'customer' } });
    const restored = f.split();
    expect(restored).toMatchObject({ note: f.source.note, aliases: f.source.aliases, fileIds: f.source.fileIds, createdAt: f.source.createdAt, status: f.source.status });
    expect(restored.mergedRelationIds).toContain(f.source.id);
    expect(restored.fileIds).not.toContain('customer-file');
    expect(f.customer().fileIds).toEqual(['customer-file', 'shared-file']);
    expect(f.customer().aliases).toEqual(['客户简称', '共同简称']);
    expect(f.customer().note).toBe('客户偏好'); expect(f.state.files).toEqual(originals);
  });
  it('keeps explicit removals and later customer additions, and uses current canonical supplier contacts', () => {
    const f = fixture(); f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    f.run({ type: 'market.relation.save', payload: { id: f.customerId, input: { ...f.customer(), aliases: ['客户简称', '共同简称', '客户新简称'], note: '客户新偏好', fileIds: ['customer-file', 'shared-file', 'new-file'] } } });
    f.run({ type: 'market.contact.save', payload: { kind: 'supplier', parentId: f.supplierId, name: '供方新联系人', role: '业务经理', email: 'supplier@example.invalid', phone: '0001', primary: true } });
    const restored = f.split(); expect(restored.aliases).toEqual(['共同简称']); expect(restored.fileIds).toEqual(['shared-file']);
    expect(restored.contacts[0].name).toBe('供方新联系人'); expect(f.customer().aliases).toEqual(['客户简称', '共同简称', '客户新简称']); expect(f.customer().fileIds).toEqual(['customer-file', 'shared-file', 'new-file']); expect(f.customer().note).toBe('客户新偏好');
  });
  it('keeps provenance through profile saves and rejects forged caller-supplied provenance', () => {
    const f = fixture(); f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    f.run({ type: 'market.relation.save', payload: { id: f.customerId, input: { ...f.customer(), note: '客户补充', supplierRelationSource: { fileIds: ['customer-file'], aliases: ['伪造'] }, holdHistoryKeys: ['伪造'] } as any } });
    const restored = f.split(); expect(restored.fileIds).toEqual(f.source.fileIds); expect(restored.aliases).toEqual(f.source.aliases); expect(restored.note).toBe(f.source.note);
  });
  it.each([false, true])('retains independent and shared hold facts without duplicating them after split and relink (legacy keys: %s)', legacy => {
    const f = fixture(); const hold = (id: string, frozen: boolean) => f.run({ type: 'market.relation.hold', payload: { id, frozen, reason: frozen ? '资料待核对' : '资料已核对' } });
    // Identical person/time/text from two independent organizations are two distinct facts.
    for (const id of [f.customerId, f.source.id]) { hold(id, true); hold(id, false); }
    if (legacy) for (const r of f.state.market.relations) delete r.holdHistoryKeys;
    f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } }); hold(f.customerId, true); hold(f.customerId, false);
    expect(f.customer().holdHistory).toHaveLength(6); const facts = structuredClone(f.customer().holdHistory);
    const restored = f.split(); expect(restored.holdHistory).toHaveLength(4); expect(f.customer().holdHistory).toEqual(facts);
    f.run({ type: 'market.relation.linkCustomer', payload: { id: restored.id, customerId: 'customer' } }); expect(f.customer().holdHistory).toEqual(facts);
    expect(f.split().holdHistory).toHaveLength(4);
  });
  it('restores the supplier compliance sources without assigning customer screening to it', () => {
    const f = fixture(); const screening = (id: string) => ({ id, kind: 'annual' as const, result: 'clear' as const, basis: '年度资料', screenedOn: '2026-11-18', nextReview: '2027-11-18', fileIds: [], at: f.ctx.now, actor: '业务员' });
    f.customer().screenings = [screening('customer-screening')]; f.state.market.relations.find(r => r.id === f.source.id)!.screenings = [screening('supplier-screening')];
    f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } }); expect(f.customer().screenings?.map(r => r.id)).toEqual(['customer-screening', 'supplier-screening']);
    f.run({ type: 'market.relation.save', payload: { id: f.customerId, input: { ...f.customer(), note: '客户补充' } } });
    const restored = f.split(); expect(restored.screenings?.map(r => r.id)).toEqual(['supplier-screening']); expect(f.customer().screenings?.map(r => r.id)).toEqual(['customer-screening']);
  });
  it('does not guess ownership for a historical merge missing its source snapshot', () => {
    const f = fixture(); const r = f.customer(); r.supplierId = f.supplierId; r.mergedRelationIds = [f.source.id]; f.state.market.relations = f.state.market.relations.filter(r => r.id !== f.source.id); const before = structuredClone(f.state);
    expect(() => f.split()).toThrow(/关联前资料/); expect(f.state).toEqual(before);
  });
  it('restores archived source status while using current supplier identity and contacts', () => {
    const f = fixture(); f.run({ type: 'market.relation.status', payload: { id: f.source.id, status: 'archived' } });
    f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    const supplier = f.state.market.suppliers.find(r => r.id === f.supplierId)!; supplier.name = '供方新名称'; supplier.country = '新加坡'; supplier.address = '新加坡港区';
    const restored = f.split(); expect(restored).toMatchObject({ status: 'archived', name: supplier.name, country: supplier.country, address: supplier.address, note: f.source.note });
  });
  it('does not remove a customer alias added after the linked supplier was renamed', () => {
    const f = fixture(); f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    f.state.market.suppliers.find(r => r.id === f.supplierId)!.name = '新名称'; f.customer().aliases.push('新名称'); f.split(); expect(f.customer().aliases).toContain('新名称'); expect(f.customer().aliases).not.toContain('供方公司');
  });
  it('refuses a source snapshot belonging to another supplier without changing state', () => {
    const f = fixture(); f.run({ type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } });
    f.customer().supplierRelationSource!.supplierId = 'another-supplier'; const before = structuredClone(f.state); expect(() => f.split()).toThrow(/关联前资料/); expect(f.state).toEqual(before);
  });
  it('allows splitting an initial dual identity that has no historical merged source', () => {
    const f = fixture(); f.state.market.relations = f.state.market.relations.filter(r => r.id !== f.source.id); f.customer().supplierId = f.supplierId;
    const restored = f.split(); expect(restored).toMatchObject({ supplierId: f.supplierId, aliases: [], fileIds: [] }); expect(f.customer().fileIds).toEqual(['customer-file', 'shared-file']);
  });
  it.each(['customer', 'supplier'] as const)('enforces the frozen-customer identity-link gate on the server (%s entry)', side => {
    const f = fixture(); f.run({ type: 'market.relation.hold', payload: { id: f.customerId, frozen: true, reason: '客户资料待核对' } }); const before = structuredClone(f.state);
    const command: MarketCommand = side === 'customer' ? { type: 'market.relation.linkSupplier', payload: { id: f.customerId, supplierId: f.supplierId } } : { type: 'market.relation.linkCustomer', payload: { id: f.source.id, customerId: 'customer' } };
    expect(() => f.run(command)).toThrow(/请先解冻/); expect(f.state).toEqual(before);
  });
  it.each(['customer', 'supplier'] as const)('reads linked name and location only from the canonical master: %s', side => {
    const f = fixture(), relation = side === 'customer' ? f.customer() : f.state.market.relations.find(r => r.id === f.source.id)!;
    if (side === 'supplier') { const supplier = f.state.market.suppliers.find(s => s.id === f.supplierId)!; supplier.country = ''; supplier.address = ''; }
    const master = side === 'customer' ? f.state.customers.find(c => c.id === 'customer')! : f.state.market.suppliers.find(s => s.id === f.supplierId)!;
    f.run({ type: 'market.relation.save', payload: { id: relation.id, input: { ...relation, name: '非主档名称', country: '新加坡', address: '独立地址', note: '关系备注' } } });
    const saved = f.state.market.relations.find(r => r.id === relation.id)!; expect(saved.name).toBe(master.name); expect(saved.country).toBe(master.country); expect(saved.address).toBe(side === 'customer' ? f.state.customers.find(c => c.id === 'customer')!.city : f.state.market.suppliers.find(s => s.id === f.supplierId)!.address); expect(saved.note).toBe('关系备注');
  });
});
