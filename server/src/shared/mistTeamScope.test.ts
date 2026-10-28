import { describe, expect, it } from 'vitest';
import { applyTeamScopeCommand, normalizeTeamScopeInput, previewTeamScope, resolveTeamScope, type TeamScopeRef } from './mistTeamScope';

// 规格 §3.4 校验清单：业务链向下全覆盖、向上只读、不扩散到兄弟分支、整单为单位、排除切断、条件看节点自身字段。
function fixture(): any {
  const order = (id: string, customerId: string, type: string, season: string, extra: any = {}) => ({ id, code: id.toUpperCase(), customerId, customer: customerId, type, season, ...extra });
  const line = (id: string, orderId: string, source: any) => ({ id, orderId, ...source });
  return {
    customers: [{ id: 'hm', name: 'H&M' }, { id: 'zara', name: 'ZARA' }],
    crm: { opportunities: [{ id: 'opp', customerId: 'hm', title: 'SS27 系列', domain: 'garment', devIds: ['dev'], quotationIds: [], orderIds: [] }], followUps: [] },
    devs: [
      { id: 'dev', code: 'DEV-1', name: '夹克', customerId: 'hm', values: { season: 'ss27', domain: 'garment' } },
      { id: 'shared-dev', code: 'DEV-2', name: '内部开发', customerId: '', values: { season: '', domain: 'garment' } },
      { id: 'fabric-dev', code: 'DEV-3', name: '面料', customerId: 'hm', values: { season: 'SS27', domain: 'fabric' } },
    ],
    market: {
      suppliers: [{ id: 'mill', name: '华盛毛纺' }, { id: 'factory', name: '远山服装' }],
      quotations: [
        { id: 'q1', code: 'QT-1', customerId: 'hm', season: 'SS27', lines: [{ sourceDevId: 'dev', family: 'garment' }] },
        { id: 'q2', code: 'QT-1-V2', customerId: 'hm', season: '', previousId: 'q1', lines: [{ sourceDevId: 'dev', family: 'garment' }] },
      ],
    },
    orders: [
      order('o1', 'hm', 'garment', 'SS27'),
      order('repeat', 'hm', 'garment', 'AW27'),
      order('sibling', 'zara', 'garment', 'SS27'),
      order('picked', 'hm', 'garment', ''),
      order('replacement', 'hm', 'garment', '', { replacementSource: { sourceOrderId: 'o1' } }),
      order('nos', 'hm', 'garment', ''),
    ],
    orderLines: [
      line('l1', 'o1', { sourceQuotationId: 'q1' }), line('l2', 'repeat', { sourceDevId: 'dev' }),
      line('l3', 'sibling', { sourceDevId: 'shared-dev' }), line('l4', 'picked', { sourceDevId: 'shared-dev' }),
      line('l5', 'replacement', {}), line('l6', 'nos', {}),
    ],
    productions: [{ id: 'pr1', orderId: 'o1', factory: '远山服装' }, { id: 'pr-sibling', orderId: 'sibling', factory: '远山服装' }],
    invoices: [{ id: 'inv1', orderId: 'o1' }],
    allocations: [{ id: 'a1', invoiceId: 'inv1', receiptId: 'rc1' }],
    fulfillment: {
      purchases: [{ id: 'p1', orderId: 'o1', supplierId: 'mill' }, { id: 'p-sibling', orderId: 'sibling', supplierId: 'mill' }],
      receipts: [{ id: 'gr1', purchaseId: 'p1' }], qcTasks: [{ id: 'qc1', factory: '远山服装', source: { kind: 'orderLine', orderId: 'o1', lineId: 'l1' } }],
      packing: [{ id: 'pk1', lineId: 'l1', shipmentId: 'sh1' }, { id: 'pk2', lineId: 'l3', shipmentId: 'sh1' }], customs: [{ id: 'cu1', shipmentId: 'sh1' }],
    },
    platform: { claims: [{ id: 'cl1', orderId: 'o1' }], credits: [{ id: 'cr1', claimId: 'cl1' }] },
    events: [],
  };
}
const scope = (conditions: any[] = [], picks: TeamScopeRef[] = [], exclusions: TeamScopeRef[] = []) => ({ conditions, picks, exclusions });
const sorted = (set: Set<string>) => [...set].sort();

describe('team scope business chain', () => {
  it('covers the whole downstream chain from a matching node, even when a converted order has another season', () => {
    const r = resolveTeamScope(fixture(), scope([{ id: 'c', customerId: 'hm', season: 'SS27', line: 'garment' }]));
    expect(sorted(r.collaborate)).toEqual(['development:dev', 'order:o1', 'order:repeat', 'order:replacement', 'quotation:q1', 'quotation:q2']);
    expect(sorted(r.readonly)).toEqual(['opportunity:opp']);
    expect(r.records).toMatchObject({ 'fulfillment.purchases': new Set(['p1']), productions: new Set(['pr1']), invoices: new Set(['inv1']), receipts: new Set(['rc1']), 'fulfillment.receipts': new Set(['gr1']), 'fulfillment.qcTasks': new Set(['qc1']), 'fulfillment.shipments': new Set(['sh1']), 'fulfillment.customs': new Set(['cu1']), 'platform.claims': new Set(['cl1']), 'platform.credits': new Set(['cr1']) });
    expect(r.records['fulfillment.packing']).toEqual(new Set(['pk1']));
    expect(r.records['fulfillment.purchases']?.has('p-sibling')).toBe(false);
  });
  it('shows upstream sources read-only without spreading to sibling branches', () => {
    const r = resolveTeamScope(fixture(), scope([], [{ kind: 'order', id: 'picked' }]));
    expect(sorted(r.collaborate)).toEqual(['order:picked']);
    expect(sorted(r.readonly)).toEqual(['development:shared-dev']);
    expect(r.collaborate.has('order:sibling') || r.readonly.has('order:sibling')).toBe(false);
  });
  it('excludes a node together with the downstream reached only through it', () => {
    const r = resolveTeamScope(fixture(), scope([], [{ kind: 'development', id: 'dev' }], [{ kind: 'quotation', id: 'q1' }]));
    expect(sorted(r.collaborate)).toEqual(['development:dev', 'order:repeat', 'quotation:q2']);
    expect(r.records.invoices).toBeUndefined();
  });
  it('does not guess a missing season and matches business line from the record itself', () => {
    const r = resolveTeamScope(fixture(), scope([{ id: 'c', customerId: 'hm', season: 'SS27' }]));
    expect(r.collaborate.has('order:nos')).toBe(false);
    expect(r.collaborate.has('development:fabric-dev')).toBe(true);
    expect(resolveTeamScope(fixture(), scope([{ id: 'c', customerId: 'hm', line: 'garment' }])).collaborate.has('development:fabric-dev')).toBe(false);
  });
  it('matches supplier or factory records and shows their orders read-only only', () => {
    const r = resolveTeamScope(fixture(), scope([{ id: 'c', supplierId: 'factory', customerId: 'zara' }]));
    expect(r.records.productions).toEqual(new Set(['pr-sibling']));
    expect(r.collaborate.size).toBe(0);
    expect(sorted(r.readonly)).toEqual(['development:shared-dev', 'order:sibling']);
  });
  it('previews counts and warns when a whole-customer condition mixes fabric and garment', () => {
    const p = previewTeamScope(fixture(), scope([{ id: 'c', customerId: 'hm' }]));
    expect(p.counts.development).toBe(2);
    expect(p.byLine.fabric).toBe(1);
    expect(p.warnings).toHaveLength(1);
    expect(previewTeamScope(fixture(), scope([{ id: 'c', customerId: 'hm', line: 'garment' }])).warnings).toEqual([]);
  });
});

describe('team scope input and command', () => {
  const teams = [{ id: 't1', name: '服装组 C' }];
  it('rejects unscoped, unknown and contradictory input', () => {
    const state = fixture();
    expect(() => normalizeTeamScopeInput(state, { teamId: 't1', conditions: [{}] }, teams)).toThrow(/至少要限定/);
    expect(() => normalizeTeamScopeInput(state, { teamId: 'other', conditions: [] }, teams)).toThrow(/小组/);
    expect(() => normalizeTeamScopeInput(state, { teamId: 't1' }, undefined)).toThrow(/核对小组/);
    expect(() => normalizeTeamScopeInput(state, { teamId: 't1', conditions: [{ customerId: 'nobody' }] }, teams)).toThrow(/客户不存在/);
    expect(() => normalizeTeamScopeInput(state, { teamId: 't1', picks: [{ kind: 'order', id: 'o1' }], exclusions: [{ kind: 'order', id: 'o1' }] }, teams)).toThrow(/既手选又排除/);
    expect(() => normalizeTeamScopeInput(state, { teamId: 't1', conditions: [{ customerId: 'hm' }, { customerId: 'hm' }] }, teams)).toThrow(/重复/);
  });
  it('stores the scope with an audit trail and keeps prior history', () => {
    const state = fixture(); let n = 0;
    const context: any = { id: () => `id-${++n}`, now: '2026-10-28T00:00:00Z', actorId: 'gm', actorName: '总经理', teams };
    const result = applyTeamScopeCommand(state, { type: 'teamScope.save', payload: { teamId: 't1', conditions: [{ customerId: 'hm', season: 'ss27' }], picks: [], exclusions: [], note: '春夏系列' } }, context);
    expect(result).toMatchObject({ teamId: 't1', order: 3 });
    applyTeamScopeCommand(state, { type: 'teamScope.save', payload: { teamId: 't1', conditions: [], picks: [], exclusions: [] } }, context);
    expect(state.teamScopes).toHaveLength(1);
    expect(state.teamScopes[0]).toMatchObject({ teamName: '服装组 C', conditions: [], updatedBy: '总经理' });
    expect(state.teamScopes[0].history.map((h: any) => h.summary)).toEqual(['条件 0 条、手选 0 笔、排除 0 笔', '条件 1 条、手选 0 笔、排除 0 笔']);
    expect(state.events[0]).toMatchObject({ entityType: 'teamScope', entityId: 't1' });
  });
});

it('does not cross the shared product library to expose its private source development',()=>{
 const state=fixture();state.market.products=[{id:'shared-product',sourceDevId:'shared-dev',sourceVersionId:'version'}];state.market.quotations=[{id:'product-quote',customerId:'hm',lines:[{productId:'shared-product',sourceDevId:'shared-dev',sourceVersionId:'version'}]}];
 const r=resolveTeamScope(state,scope([],[{kind:'quotation',id:'product-quote'}]));
 expect(r.collaborate.has('quotation:product-quote')).toBe(true);expect(r.readonly.has('development:shared-dev')).toBe(false);
});
