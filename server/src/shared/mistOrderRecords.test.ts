import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistContext } from './mistWorkspace';
import { projectState } from '../mist/access';
import { scopedTargetViolation } from './mistDataScope';

function fixture() {
  let sequence = 0;
  const context: MistContext = { id: () => `record-${++sequence}`, now: '2026-10-29T02:00:00Z', actorName: '业务甲', actorId: 'sales', members: [{ id: 'sales', name: '业务甲', active: true, groups: ['fabric', 'garment'] }], authority: { supplier: {}, orderReviewerIds: { fabric: ['reviewer'], garment: ['reviewer'] } } };
  let state = createMistState(context, 'empty');
  state.customers.push({ id: 'customer', name: '样本客户', code: 'C', country: '', city: '', industry: '', owner: '其他业务', ownerId: 'other', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  for (const id of ['contract', 'technical', 'photo']) state.files.push({ id, name: `${id}.pdf`, mimeType: 'application/pdf', size: 1, storageKey: `fixture/${id}`, createdAt: context.now, uploadedBy: 'sales' });
  const created = applyMistCommand(state, { type: 'order.create', payload: { type: 'fabric', customerId: 'customer', season: 'SS', currency: 'USD', due: '2026-12-01', ownerId: 'sales', governance: { kind: 'external', poNumber: 'TEST-PO', confirmationFileIds: ['contract'], internalPurpose: '', receiver: '', paymentMethod: 'TT', depositPercent: 30, paymentNote: '按合同', incoterm: 'FOB', deliveryPlace: '上海' }, lines: [{ name: '样本布', style: 'TEST', qty: 10, price: 2, unit: '米', img: 'fabric' }] } }, context);
  state = created.state; const orderId = created.result.orderId!;
  state = applyMistCommand(state, { type: 'order.governance.submit', payload: { orderId } }, context).state;
  state = applyMistCommand(state, { type: 'order.governance.decide', payload: { id: orderId, decision: 'approved', note: '核对原合同' } }, { ...context, actorId: 'reviewer' }).state;
  state.productions.push({ id: 'production', code: 'PRD', orderId, lineId: state.orderLines[0].id, order: state.orders[0].code, name: '样本布', factory: '样本工厂', qty: 10, pct: 0, col: 'cut', due: '2026-12-01', img: 'fabric' });
  return { state, context, orderId };
}

describe('order source records', () => {
  it('appends original attachments without altering approved commercial facts and deduplicates ids', () => {
    const f = fixture(), before = structuredClone(f.state.orders[0].governance);
    const command: any = { type: 'order.files.add', payload: { orderId: f.orderId, fileIds: ['technical', 'photo', 'technical'] } };
    expect(mistCommandPermission(command)).toBe('orders:write');
    const { state } = applyMistCommand(f.state, command, f.context);
    expect(state.orders[0].fileIds).toEqual(['technical', 'photo']);
    expect(state.orders[0].governance).toEqual(before);
    expect(state.events[0]).toMatchObject({ entityType: 'order', entityId: f.orderId, fileIds: ['technical', 'photo'], actor: '业务甲' });
    expect(applyMistCommand(state, command, f.context).state.orders[0].fileIds).toEqual(['technical', 'photo']);
    expect(() => applyMistCommand(state, { ...command, payload: { ...command.payload, fileIds: ['missing'] } }, f.context)).toThrow('附件');
  });
  it('keeps attachment reads and direct writes within the owning order scope', () => {
    const f = fixture();
    const state = applyMistCommand(f.state, { type: 'order.files.add', payload: { orderId: f.orderId, fileIds: ['technical'] } } as any, f.context).state;
    const actor: any = { userId: 'outsider', roles: [], permissions: ['orders:read'], authorizationLoaded: true };
    const scope = { userIds: ['outsider'], teamIds: [] };
    expect(projectState(state, actor, () => createMistState(f.context, 'empty'), undefined, scope).state.files.some(file => file.id === 'technical')).toBe(false);
    expect(scopedTargetViolation(state, scope, { type: 'order.files.add', payload: { orderId: f.orderId, fileIds: ['technical'] } })).toEqual({ path: 'orders', id: f.orderId });
  });
  it('persists progress notes with author/time without asserting an unproved production advance', () => {
    const f = fixture();
    const { state } = applyMistCommand(f.state, { type: 'production.update', payload: { id: 'production', pct: 0, note: '工厂已通知排产，具体开产日待原件核对' } }, f.context);
    expect(state.events.some(event => event.entityType === 'production' && event.entityId === 'production' && event.text.includes('工厂已通知排产') && event.actor === '业务甲' && event.at === f.context.now)).toBe(true);
    expect(state.productions[0].pct).toBe(0);
    expect(state.fulfillment.productionFacts.some(fact => fact.release)).toBe(false);
    expect(() => applyMistCommand(state, { type: 'production.update', payload: { id: 'production', pct: 10, note: '未经放行' } }, f.context)).toThrow();
  });
});
