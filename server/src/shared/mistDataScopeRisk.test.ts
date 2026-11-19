import { describe, expect, it } from 'vitest';
import { applyDataScope, scopedVisibility, scopedWriteViolation, type MistDataScope } from './mistDataScope';
import { applyMistCommand, createMistState, type MistContext, type MistState } from './mistWorkspace';

function fixture() {
  let seq = 0;
  const context: MistContext = {
    id: () => `risk-scope-${++seq}`, now: '2026-11-19T14:00:00.000Z', actorId: 'sales', actorName: 'Sales',
    authority: { supplier: {}, risk: { all: false, orders: true, customers: true } },
  };
  const state = createMistState(context, 'empty');
  state.customers = [
    { id: 'mine', name: 'My customer', owner: 'Sales', ownerId: 'sales' },
    { id: 'colleague', name: 'Team customer', owner: 'Colleague', ownerId: 'colleague' },
    { id: 'unrelated', name: 'Unrelated customer', owner: 'Other', ownerId: 'other' },
  ] as MistState['customers'];
  state.market.relations = [
    { id: 'my-relation', name: 'My customer', customerId: 'mine' },
    { id: 'team-relation', name: 'Team customer', customerId: 'colleague' },
    { id: 'unrelated-relation', name: 'Unrelated customer', customerId: 'unrelated' },
    { id: 'supplier-relation', name: 'Supplier', supplierId: 'supplier' },
  ] as MistState['market']['relations'];
  state.market.suppliers = [{ id: 'supplier', name: 'Supplier' }] as MistState['market']['suppliers'];
  const scope: MistDataScope = { userIds: ['sales'], teamIds: [] };
  const save = (kind: string, id: string, professional = false) => applyMistCommand(state, {
    type: 'platform.risk.save', payload: { title: 'Credit review', basis: 'Current source facts', owner: 'Sales', level: 'warning', type: 'credit', source: { kind, id } },
  } as any, professional ? { ...context, authority: { ...context.authority!, risk: { all: true, orders: true, customers: true } } } : context);
  return { state, context, scope, save };
}

describe('customer-source risk row scope', () => {
  it.each([['relation', 'my-relation'], ['customer', 'mine']])('keeps a real own %s risk writable and readable after domain creation', (kind, id) => {
    const f = fixture(), original = structuredClone(f.state), created = f.save(kind, id);
    expect(created.state.platform.risks[0]).toMatchObject({ id: created.result.id, ownerId: 'sales', source: { kind, id } });
    expect(scopedWriteViolation(f.state, created.state, f.scope)).toBeNull();
    expect(applyDataScope(created.state, f.scope, 'sales').platform.risks.map(r => r.id)).toEqual([created.result.id]);
    const acknowledged = applyMistCommand(created.state, { type: 'platform.risk.transition', payload: { id: created.result.id, state: 'Acknowledged', resolution: 'Source owner takes responsibility' } } as any, f.context);
    expect(scopedWriteViolation(created.state, acknowledged.state, f.scope)).toBeNull();
    expect(f.state).toEqual(original);
  });

  it.each(['department', 'team', 'line'] as const)('follows existing %s business scope without exposing another customer', reach => {
    const f = fixture();
    f.state.orders = [{ id: 'team-order', code: 'SO-TEAM', type: 'garment', customerId: 'colleague', ownerId: 'colleague' }] as MistState['orders'];
    if (reach === 'department') f.scope.userIds.push('colleague');
    if (reach === 'team') {
      f.scope.teamIds.push('team');
      f.state.teamScopes = [{ teamId: 'team', conditions: [], picks: [{ kind: 'order', id: 'team-order' }], exclusions: [] }];
    }
    if (reach === 'line') f.scope.lines = ['garment'];
    const created = f.save('relation', 'team-relation', true);
    expect(scopedWriteViolation(f.state, created.state, f.scope)).toBeNull();
    expect(scopedVisibility(created.state, f.scope, false).get('platform.risks')!.has(String(created.result.id))).toBe(true);
    const unrelated = f.save('relation', 'unrelated-relation', true);
    expect(scopedWriteViolation(f.state, unrelated.state, f.scope)).toEqual({ path: 'platform.risks', id: unrelated.result.id });
  });

  it.each([['relation', 'unrelated-relation'], ['customer', 'unrelated'], ['relation', 'supplier-relation'], ['supplier', 'supplier']])('does not turn directory access or a matching assigned owner into %s source scope', (kind, id) => {
    const f = fixture(), created = f.save(kind, id, true);
    expect(created.state.platform.risks[0].ownerId).toBe('sales');
    expect(scopedWriteViolation(f.state, created.state, f.scope)).toEqual({ path: 'platform.risks', id: created.result.id });
    expect(applyDataScope(created.state, f.scope, 'sales').platform.risks).toEqual([]);
  });

  it('keeps an upstream customer source read-only when only its downstream order is writable', () => {
    const f = fixture();
    f.state.devs = [{ id: 'upstream', customerId: 'colleague', ownerId: 'colleague', values: { domain: 'fabric' } }] as MistState['devs'];
    f.state.orders = [{ id: 'my-order', type: 'garment', customerId: 'mine', ownerId: 'sales' }] as MistState['orders'];
    f.state.orderLines = [{ id: 'my-line', orderId: 'my-order', sourceDevId: 'upstream', qty: 1, price: 1 }] as MistState['orderLines'];
    const created = f.save('relation', 'team-relation', true), id = String(created.result.id);
    expect(scopedVisibility(created.state, f.scope).get('platform.risks')!.has(id)).toBe(true);
    expect(scopedVisibility(created.state, f.scope, false).get('platform.risks')!.has(id)).toBe(false);
    expect(scopedWriteViolation(f.state, created.state, f.scope)).toEqual({ path: 'platform.risks', id });
  });

  it('does not grant the domain permission to write another owner or supplier risk', () => {
    const f = fixture();
    expect(() => f.save('relation', 'unrelated-relation')).toThrow(/本人负责/);
    expect(() => f.save('supplier', 'supplier')).toThrow(/本人负责/);
    f.context.authority!.risk!.customers = false;
    expect(() => f.save('relation', 'my-relation')).toThrow(/客户档案写权限/);
  });

  it('does not resolve a foreign or removed customer through the relation label', () => {
    const f = fixture();
    f.state.market.relations.push({ id: 'foreign', name: 'My customer', customerId: 'missing-customer' } as any);
    const raw = { id: 'foreign-risk', ownerId: 'sales', orderId: '', source: { kind: 'relation', id: 'foreign' } } as any;
    f.state.platform.risks.push(raw);
    expect(applyDataScope(f.state, f.scope, 'sales').platform.risks).toEqual([]);
  });

  it('does not use a customer label to expose an inconsistent hidden order reference', () => {
    const f = fixture();
    f.state.orders = [{ id: 'hidden-order', type: 'garment', customerId: 'unrelated', ownerId: 'other' }] as MistState['orders'];
    f.state.platform.risks.push({ id: 'inconsistent', orderId: 'hidden-order', source: { kind: 'relation', id: 'my-relation' } } as any);
    expect(applyDataScope(f.state, f.scope, 'sales').platform.risks).toEqual([]);
  });
});
