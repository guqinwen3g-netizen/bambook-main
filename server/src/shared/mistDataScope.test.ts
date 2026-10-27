import { expect, it } from 'vitest';
import { applyDataScope, scopedWriteViolation } from './mistDataScope';

it('keeps an upstream development read-only when a team only collaborates on its order', () => {
  const state: any = {
    customers: [{ id: 'customer', ownerId: 'another' }],
    crm: { opportunities: [], followUps: [] },
    devs: [{ id: 'upstream', customerId: 'customer', ownerId: 'another', values: {} }],
    market: { quotations: [], suppliers: [] },
    orders: [{ id: 'order', customerId: 'customer', ownerId: 'another', type: 'garment' }],
    orderLines: [{ id: 'line', orderId: 'order', sourceDevId: 'upstream' }],
    teamScopes: [{ teamId: 'team', conditions: [], picks: [{ kind: 'order', id: 'order' }], exclusions: [] }],
    fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const scope = { userIds: ['member'], teamIds: ['team'] };
  expect(applyDataScope(state, scope, 'member').devs).toHaveLength(1);
  const after = structuredClone(state); after.devs[0].name = 'changed';
  expect(scopedWriteViolation(state, after, scope)).toMatchObject({ path: 'devs', id: 'upstream' });
});

it('does not expose totals for receipts allocated to out-of-scope invoices', () => {
  const state: any = {
    customers: [{ id: 'mine', ownerId: 'member' }, { id: 'other', ownerId: 'another' }],
    crm: { opportunities: [], followUps: [] }, devs: [], market: { quotations: [], suppliers: [] },
    orders: [{ id: 'order-mine', customerId: 'mine', ownerId: 'member', type: 'garment' }, { id: 'order-other', customerId: 'other', ownerId: 'another', type: 'garment' }],
    orderLines: [], invoices: [{ id: 'invoice-mine', orderId: 'order-mine' }, { id: 'invoice-other', orderId: 'order-other' }],
    receipts: [{ id: 'receipt', code: 'RC-1', date: '2026-10-01', payer: 'Customer', amount: 1000, remaining: 0, currency: 'USD', ref: '', state: 'matched' }], allocations: [{ id: 'a', invoiceId: 'invoice-mine', receiptId: 'receipt', amount: 400, currency: 'USD' }, { id: 'b', invoiceId: 'invoice-other', receiptId: 'receipt', amount: 600, currency: 'USD' }],
    fulfillment: {}, platform: {}, events: [], tasks: [], notifications: [], calendar: [],
  };
  const projected: any = applyDataScope(state, { userIds: ['member'], teamIds: [] }, 'member');
  expect(projected.receipts.find((r: any) => r.id === 'receipt')?.amount).not.toBe(1000);
  const after = structuredClone(state); after.receipts[0].amount = 900;
  expect(scopedWriteViolation(state, after, { userIds: ['member'], teamIds: [] })).toMatchObject({ path: 'receipts', id: 'receipt' });
});
