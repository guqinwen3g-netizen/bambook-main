import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { monthLocked } from './mistPeriodClose';

const ctx = { id: (() => { let n = 0; return () => `pc-${++n}`; })(), now: '2026-11-05T02:00:00Z', actorId: 'fin', actorName: '林舒' } as MistContext;
function setup() {
  let state = createMistState(ctx, 'empty');
  const run = (command: MistCommand) => { const r = applyMistCommand(state, command, ctx); state = r.state; return r.result; };
  run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-09-28', payer: 'Cedar', amount: 100, currency: 'USD', ref: 'SEP' }, { date: '2026-10-28', payer: 'Cedar', amount: 200, currency: 'USD', ref: 'OCT' }] } });
  return { run, get state(): MistState { return state; } };
}
describe('month-end close', () => {
  it('closes months in order and locks every finance fact dated in or before them', () => {
    const f = setup();
    expect(() => f.run({ type: 'finance.period.close', payload: { month: '2026-11', note: '月中' } })).toThrow('已过去');
    f.run({ type: 'finance.period.close', payload: { month: '2026-09', note: '银行余额与流水核对一致' } });
    expect(() => f.run({ type: 'finance.period.close', payload: { month: '2026-11', note: 'x' } })).toThrow('已过去');
    expect(monthLocked(f.state, '2026-08')).toBe(true);
    expect(() => f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-09-30', payer: 'X', amount: 1, currency: 'USD', ref: 'LATE' }] } })).toThrow('2026-09 已结账');
    f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-30', payer: 'X', amount: 1, currency: 'USD', ref: 'OK' }] } });
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    expect(() => f.run({ type: 'finance.payment.save', payload: { date: '2026-10-15', payee: 'Mill', amount: 5, currency: 'USD', ref: '' } })).toThrow('已结账');
    f.run({ type: 'finance.payment.save', payload: { date: '2026-11-03', payee: 'Mill', amount: 5, currency: 'USD', ref: '' } });
  });
  it('reopens only the latest closed month, with the approval permission and a reason', () => {
    const f = setup();
    f.run({ type: 'finance.period.close', payload: { month: '2026-09', note: 'ok' } });
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: 'ok' } });
    expect(mistCommandPermission({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: 'x' } })).toBe('invoices:approve:writeoff');
    expect(() => f.run({ type: 'finance.period.reopen', payload: { month: '2026-09', reason: '补登' } })).toThrow('2026-10');
    f.run({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: '漏登一笔到账' } });
    f.run({ type: 'finance.importReceipts', payload: { receipts: [{ date: '2026-10-29', payer: 'X', amount: 3, currency: 'USD', ref: 'FIX' }] } });
    expect(f.state.periodCloses!.map(c => [c.month, !!c.reopened])).toEqual([['2026-09', false], ['2026-10', true]]);
  });
});
describe('closed month locks CI receivable confirmation, rejection and void (by issuedAt month, as vouchers)', () => {
  function withCi(issuedAt: string) {
    const f = setup(), s = f.state as MistState;
    s.fulfillment.shipments.push({ id: 'sh', code: 'SH', customerId: 'c', customer: 'Cedar', domain: 'garment', consignee: 'Cedar', mode: 'sea', portOfLoading: '上海', portOfDischarge: '汉堡', incoterm: 'FOB', plannedDate: '2026-11-25', booking: '', lines: [], note: '', fileIds: [], state: 'ready', requestedBy: '单证', requesterId: 'docs', createdAt: ctx.now } as never);
    s.fulfillment.documents.push({ id: 'ci', shipmentId: 'sh', orderId: 'o', type: 'CI', number: 'CI-OCT', version: 1, title: 'CI', dueDate: '2026-12-01', content: '已核对', fileIds: ['f'], status: 'issued', createdAt: ctx.now, issuedAt: issuedAt + 'T02:00:00Z', actor: '单证', invoiceId: 'inv' });
    s.invoices.push({ id: 'inv', code: 'CI-OCT', orderId: 'o', order: 'SO', customer: 'Cedar', due: '2026-12-01', amount: 100, open: 0, currency: 'USD', financeStatus: 'pending', sourceDocumentId: 'ci', issuedAt });
    return f;
  }
  const confirm = { type: 'finance.receivable.confirm', payload: { invoiceId: 'inv' } } as MistCommand;
  const reject = { type: 'finance.receivable.reject', payload: { invoiceId: 'inv', reason: '金额有误' } } as MistCommand;
  const voidCi = { type: 'fulfillment.documents.void', payload: { id: 'ci', reason: '客户改单' } } as MistCommand;
  it('refuses confirm, reject and void of an October CI once October is closed', () => {
    const f = withCi('2026-10-20');
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    for (const command of [confirm, reject, voidCi]) expect(() => f.run(command)).toThrow(/2026-10 已结账.*请先反结账/);
    expect(f.state.invoices[0]).toMatchObject({ financeStatus: 'pending' });expect(f.state.invoices[0].voidedAt).toBeUndefined();
  });
  it('allows them again after reopening the month', () => {
    const f = withCi('2026-10-20');
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    f.run({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: '十月 CI 待确认' } });
    f.run(confirm);expect(f.state.invoices[0].financeStatus).toBe('confirmed');
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '复结' } });
    expect(() => f.run(voidCi)).toThrow('2026-10 已结账');
    f.run({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: '作废 CI' } });
    f.run(voidCi);expect(f.state.invoices[0].voidedAt).toBeTruthy();
  });
  it('does not lock a CI issued in an open month', () => {
    const f = withCi('2026-11-02');
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    f.run(confirm);expect(f.state.invoices[0].financeStatus).toBe('confirmed');
    f.run(voidCi);expect(f.state.invoices[0].voidedAt).toBeTruthy();
    const g = withCi('2026-11-02');g.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '十月核对' } });
    g.run(reject);expect(g.state.invoices[0].financeStatus).toBe('rejected');
  });
});
describe('monthly voucher export', () => {
  it('produces balanced suggested entries with account codes and period-rate CNY', async () => {
    const { monthlyVouchers } = await import('./mistVoucherExport');
    const f = setup();
    (f.state as any).fxPeriodRates = [{ id: 'r', code: 'R', month: '2026-10', currency: 'USD', rate: '7.10', source: '中行', createdAt: '', actor: '' }];
    const lines = monthlyVouchers(f.state, '2026-10');
    expect(lines.map(l => l.account)).toEqual(['1002', '2203']);
    expect(lines[0]).toMatchObject({ currency: 'USD', amount: 200, rate: 7.1, debit: 1420 });
    const sum = (k: 'debit' | 'credit') => lines.reduce((n, l) => n + (l[k] || 0), 0);
    expect(sum('debit')).toBe(sum('credit'));
  });
});
