import { describe, expect, it } from 'vitest';
import type { TokenPayload } from '../auth/service';
import { createMistState, type MistState } from '../shared/mistWorkspace';
import { monthlyFinanceSummary } from '../shared/mistFinanceReports';
import { projectState, MIST_READ_SECTIONS } from './access';
import * as XLSX from 'xlsx';

const context = { id: () => 'fixture', now: '2026-10-14T00:00:00Z', actorName: '模拟业务员' };
const empty = () => createMistState(context, 'empty');
const reader = (permissions: string[] = [...new Set(MIST_READ_SECTIONS.flatMap(section => section.permissions)), 'sensitive:tax_base']): TokenPayload => ({ userId: 'member', roles: [], departmentIds: [], permissions, authorizationLoaded: true });
function addBranch(state: MistState, id: string, ownerId: string, amount: number) {
  state.customers.push({ id: 'customer-' + id, ownerId, name: id } as any);
  state.orders.push({ id, ownerId, customerId: 'customer-' + id, type: 'garment', code: id, amount, currency: 'USD' } as any);
  state.orderLines.push({ id: 'line-' + id, orderId: id } as any);
  state.productions.push({ id: 'production-' + id, orderId: id, lineId: 'line-' + id, closed: true, history: [{ note: 'history-' + id }] } as any);
  state.fulfillment.productionFacts.push({ productionId: 'production-' + id, note: 'fact-' + id } as any);
  state.invoices.push({ id: 'invoice-' + id, orderId: id, currency: 'USD', amount, open: 0 } as any);
  state.receipts.push({ id: 'receipt-' + id, amount, currency: 'USD', date: '2026-10-02', remaining: 0 } as any);
  state.allocations.push({ id: 'allocation-' + id, invoiceId: 'invoice-' + id, receiptId: 'receipt-' + id, amount, currency: 'USD' } as any);
  const costs = state as MistState & { orderCosts?: { expenses: any[] } };
  (costs.orderCosts ??= { expenses: [] }).expenses.push({ id: 'expense-' + id, amount: 10, currency: 'USD', date: '2026-10-03', shares: [{ orderId: id, amount: 10 }] });
  state.events.push({ id: 'event-' + id, entityType: 'production', entityId: 'production-' + id, text: 'history-' + id, fileIds: [] } as any);
}

// These are tests of the server projection consumed by read-only views, not a claim of UI acceptance.
describe('read-only report sources respect module and row scope', () => {

  it('does not turn reports:read into access to orders, processing history or financial amounts', () => {
    const state = empty(); addBranch(state, 'private', 'member', 98765);
    const projected = projectState(state, reader(['reports:read']), empty).state;
    expect(projected.orders).toEqual([]); expect(projected.productions).toEqual([]);
    expect(projected.fulfillment.productionFacts).toEqual([]); expect(projected.events).toEqual([]);
    expect(projected.receipts).toEqual([]); expect(projected.invoices).toEqual([]);
    expect(monthlyFinanceSummary(projected, '', '')).toEqual([]);
    expect(state.orders).toHaveLength(1);
  });

  it('applies the current permission ceiling before counting or summarizing records', () => {
    const state = empty(); addBranch(state, 'mine', 'member', 120);
    const actor = { ...reader(), permissionCeiling: ['orders:read', 'production:read'] };
    const projected = projectState(state, actor, empty, undefined, { userIds: ['member'], teamIds: [] }).state;
    expect(projected.orders).toHaveLength(1); expect(projected.productions).toHaveLength(1);
    expect(projected.invoices).toEqual([]); expect(projected.receipts).toEqual([]);
    expect(monthlyFinanceSummary(projected, '', '')).toEqual([]);
  });

  it('allows the company-wide authorized reader to see both branches without mutating business state', () => {
    const state = empty(); addBranch(state, 'first', 'member', 120); addBranch(state, 'second', 'other', 80);
    const original = structuredClone(state), projected = projectState(state, reader(), empty).state;
    expect(projected.orders).toHaveLength(2); expect(projected.productions).toHaveLength(2);
    expect(monthlyFinanceSummary(projected, '', '')[0]).toMatchObject({ cashIn: 200, expense: 20 });
    expect(state).toEqual(original);
  });
});
