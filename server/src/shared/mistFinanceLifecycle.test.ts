import { describe, expect, it } from 'vitest';
import {
  applyMistCommand, createMistState, mistBankAccountBalances, mistFxLockUsage, mistMoneyMinor,
  mistReceiptSettledMinor, type MistCommand, type MistContext, type MistInvoice,
} from './mistWorkspace';
import { fxSettledAverage } from './mistFxRates';
import { monthlyVouchers, type VoucherLine } from './mistVoucherExport';

function setup() {
  let n = 0;
  const ctx: MistContext = { id: () => `chain-${++n}`, now: '2026-11-05T02:00:00Z', actorId: 'finance', actorName: '财务' };
  let state = createMistState(ctx, 'empty');
  const run = (command: MistCommand) => {
    const out = applyMistCommand(state, command, ctx); state = out.state; return out.result;
  };
  const account = (currency: string, accountNo: string) => String(run({ type: 'finance.account.save', payload: {
    name: `${currency}户`, bankName: '中行', accountNo, currency, openingDate: '2026-01-01', openingBalance: 0,
  } }).id);
  const usd = account('USD', '1111'), cny = account('CNY', '2222');
  const receipt = (amount: number, ref: string, currency = 'USD', accountId: string | undefined = usd) => {
    run({ type: 'finance.importReceipts', payload: { accountId, receipts: [{ date: '2026-10-05', payer: 'Cedar', amount, currency, ref }] } });
    return state.receipts.find(r => r.ref === ref && r.accountId === accountId)!.id;
  };
  const invoice = (id: string, amount: number, currency = 'USD', pending = false) => {
    // Opening receivables use the real customer link without needing an unrelated order/shipment fixture.
    const row: MistInvoice = { id, code: id.toUpperCase(), orderId: '', order: '', customer: 'Cedar', customerId: 'customer',
      due: '2026-10-30', issuedAt: '2026-10-01', amount, open: pending ? 0 : amount, currency,
      opening: { originalAmount: amount, note: '期初应收', registeredAt: ctx.now, registeredBy: ctx.actorName },
      ...(pending ? { financeStatus: 'pending' as const } : {}) };
    state.invoices.push(row); return id;
  };
  const settle = (amount: number, localAmount: number, ref: string, extra: { lockId?: string; receipts?: Array<{ receiptId: string; amount: number }> } = {}) =>
    String(run({ type: 'finance.fx.settle', payload: { date: '2026-10-10', fromAccountId: usd, toAccountId: cny, amount, localAmount, ref, ...extra } }).id);
  const lock = (amount: number) => String(run({ type: 'finance.fx.lock', payload: {
    date: '2026-10-08', bankName: '中行', currency: 'USD', amount, rate: '7.1', localCurrency: 'CNY', settleBy: '2026-11-30', ref: 'FWD-1',
  } }).id);
  const balance = (id: string) => Math.round(mistBankAccountBalances(state).accounts.find(a => a.account.id === id)!.balance * 100);
  const rejectUnchanged = (command: MistCommand, message: string) => {
    const before = structuredClone(state); expect(() => run(command)).toThrow(message); expect(state).toEqual(before);
  };
  return { get state() { return state; }, ctx, run, account, usd, cny, receipt, invoice, settle, lock, balance, rejectUnchanged };
}
const voucherMinor = (rows: VoucherLine[], side: 'debit' | 'credit') => rows.reduce((sum, row) => sum + Math.round((row[side] || 0) * 100), 0);

describe('应收 → 多票核销 → 部分冲正', () => {
  it('确认后核销多票，只冲回选中的核销，并可重新使用释放的到账余额', () => {
    const f = setup(), receiptId = f.receipt(100.03, 'MULTI');
    f.invoice('i1', 40.01, 'USD', true); f.invoice('i2', 60.02, 'USD', true);
    f.rejectUnchanged({ type: 'finance.reconcile', payload: { receiptId, lines: [{ invoiceId: 'i1', amount: 40.01 }, { invoiceId: 'i2', amount: 60.02 }] } }, '待财务确认');
    for (const invoiceId of ['i1', 'i2']) f.run({ type: 'finance.receivable.confirm', payload: { invoiceId } });
    expect(f.state.invoices.every(i => i.financeConfirmedById === 'finance')).toBe(true);
    f.rejectUnchanged({ type: 'finance.receivable.confirm', payload: { invoiceId: 'i1' } }, '已由财务确认');
    f.rejectUnchanged({ type: 'finance.receivable.reject', payload: { invoiceId: 'i1', reason: '金额错误' } }, '已由财务确认');
    f.run({ type: 'finance.reconcile', payload: { receiptId, lines: [{ invoiceId: 'i1', amount: 40.01 }, { invoiceId: 'i2', amount: 60.02 }] } });
    const [first, second] = structuredClone(f.state.allocations);
    f.run({ type: 'finance.allocation.reverse', payload: { allocationId: first.id, reason: '第一张核错' } });
    expect(f.state.allocations).toEqual([second]);
    expect(f.state.invoices.map(i => mistMoneyMinor(i.open))).toEqual([4001, 0]);
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(4001);
    expect(f.state.receipts[0].state).not.toBe('matched');
    expect(f.state.financeReversals![0]).toMatchObject({ allocation: first, actorId: 'finance', reason: '第一张核错' });
    f.rejectUnchanged({ type: 'finance.allocation.reverse', payload: { allocationId: first.id, reason: '重复冲正' } }, '不存在');
    f.run({ type: 'finance.reconcile', payload: { receiptId, invoiceId: 'i1', amount: 20.01 } });
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(2000);
    expect(f.state.invoices.map(i => mistMoneyMinor(i.open))).toEqual([2000, 0]);
    expect(f.balance(f.usd)).toBe(10003); // 核销与核销冲正均不改变银行实际到账。
  });

  it.each([
    ['7.8', 1321, 'credit'], ['7.6', 679, 'debit'],
  ] as const)('跨币种多票核销 @%s：凭证保留两种原币与汇兑差，冲正后只回滚对应一票', (eurRate, difference, side) => {
    const f = setup(), eur = f.account('EUR', '3333'), receiptId = f.receipt(150.01, 'CROSS', 'EUR', eur);
    f.ctx.now = '2026-10-05T02:00:00Z';
    f.invoice('usd-invoice', 108.01); f.invoice('cny-invoice', 390, 'CNY');
    for (const [currency, rate] of [['EUR', eurRate], ['USD', '7.1']]) f.run({ type: 'fxrate.period.save', payload: { month: '2026-10', currency, rate, source: '月末牌价' } });
    f.run({ type: 'finance.reconcile', payload: { receiptId, rateBasis: '银行水单', lines: [
      { invoiceId: 'usd-invoice', amount: 108.01, rate: '1.08' }, { invoiceId: 'cny-invoice', amount: 390, rate: '7.8' },
    ] } });
    const [first, second] = structuredClone(f.state.allocations);
    expect(mistMoneyMinor(first.receiptAmount!)).toBe(10001);
    expect(mistMoneyMinor(second.receiptAmount!)).toBe(5000);
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(0);
    const crossLines = () => monthlyVouchers(f.state, '2026-10').filter(l => l.source === `${f.state.receipts[0].code}/USD-INVOICE`);
    const before = crossLines();
    expect(before.map(l => [l.account, l.currency, mistMoneyMinor(l.amount)])).toEqual([
      ['2203', 'EUR', 10001], ['1122', 'USD', 10801], ['6603.02', 'CNY', difference],
    ]);
    expect(Math.round((before[2][side] || 0) * 100)).toBe(difference);
    expect(voucherMinor(before, 'debit')).toBe(voucherMinor(before, 'credit'));
    // Export sequence numbers are regenerated; compare the retained voucher's business fields.
    const keptLines = () => monthlyVouchers(f.state, '2026-10').filter(l => l.source.endsWith('/CNY-INVOICE')).map(({ no, ...line }) => line);
    const kept = keptLines();
    f.run({ type: 'finance.allocation.reverse', payload: { allocationId: first.id, reason: '客户更正付款用途' } });
    expect(crossLines()).toEqual(before);
    const reversalLines = monthlyVouchers(f.state, '2026-10').filter(l => l.source === f.state.financeReversals![0].id);
    expect(reversalLines.map(l => l.account)).toEqual(['1122', '2203', '6603.02']);
    expect(voucherMinor(reversalLines, 'debit')).toBe(voucherMinor(reversalLines, 'credit'));
    expect(keptLines()).toEqual(kept);
    expect(f.state.allocations).toEqual([second]);
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(10001);
    expect(f.state.invoices.map(i => mistMoneyMinor(i.open))).toEqual([10801, 0]);
    expect(f.state.financeReversals![0].allocation).toEqual(first);
    expect(f.balance(eur)).toBe(15001);
  });

  it('跨币种凭证缺一侧月末汇率时保留各侧原币，缺失折算不生成汇兑差', () => {
    const f = setup(), eur = f.account('EUR', '3333'), receiptId = f.receipt(100, 'NO-RATE', 'EUR', eur);
    f.ctx.now = '2026-10-05T02:00:00Z';
    f.invoice('i1', 108);
    f.run({ type: 'fxrate.period.save', payload: { month: '2026-10', currency: 'EUR', rate: '7.8', source: '月末牌价' } });
    f.run({ type: 'finance.reconcile', payload: { receiptId, invoiceId: 'i1', rate: '1.08', rateBasis: '客户确认' } });
    const lines = monthlyVouchers(f.state, '2026-10').filter(l => l.source.endsWith('/I1'));
    expect(lines.map(l => [l.currency, mistMoneyMinor(l.amount), l.rate])).toEqual([['EUR', 10000, 7.8], ['USD', 10800, null]]);
    expect(lines[1].credit).toBeNull();
  });
});

describe('锁汇 → 部分结汇 → 冲正', () => {
  it('两种外币间的结汇按各自月末汇率折算人民币，冲正后撤回对应凭证', () => {
    const f = setup(), eur = f.account('EUR', '3333'); f.receipt(100.01, 'USD-EUR');
    for (const [currency, rate] of [['EUR', '7.8'], ['USD', '7.1']]) f.run({ type: 'fxrate.period.save', payload: { month: '2026-10', currency, rate, source: '月末牌价' } });
    const id = String(f.run({ type: 'finance.fx.settle', payload: { date: '2026-10-10', fromAccountId: f.usd, toAccountId: eur,
      amount: 100.01, localAmount: 90.01, ref: 'USD-EUR-SLIP' } }).id);
    const code = f.state.fxRecords!.find(r => r.id === id)!.code;
    const lines = monthlyVouchers(f.state, '2026-10').filter(l => l.source === code);
    expect(lines.map(l => [l.account, l.currency, mistMoneyMinor(l.amount)])).toEqual([
      ['1002', 'EUR', 9001], ['1002', 'USD', 10001], ['6603.02', 'CNY', 799],
    ]);
    expect(voucherMinor(lines, 'debit')).toBe(71007);
    expect(voucherMinor(lines, 'credit')).toBe(71007);
    expect(f.balance(eur)).toBe(9001); expect(f.balance(f.usd)).toBe(0);
    f.run({ type: 'finance.fx.reverse', payload: { id, reason: '币种录错' } });
    expect(monthlyVouchers(f.state, '2026-10').filter(l => l.source === code)).toEqual([]);
    expect(f.balance(eur)).toBe(0); expect(f.balance(f.usd)).toBe(10001);
  });

  it('只释放被冲正交割的合同额度、到账分配及银行余额，其他交割保留', () => {
    const f = setup(), receiptId = f.receipt(300.03, 'FORWARD'), lockId = f.lock(300.03);
    const a = f.settle(100.01, 710.07, 'SLIP-A', { lockId, receipts: [{ receiptId, amount: 100.01 }] });
    f.rejectUnchanged({ type: 'finance.fx.settle', payload: { date: '2026-10-10', fromAccountId: f.usd, toAccountId: f.cny,
      amount: 200.03, localAmount: 1420.21, ref: 'OVER-LOCK', lockId } }, '超过锁汇合同剩余');
    const b = f.settle(200.02, 1420.14, 'SLIP-B', { lockId, receipts: [{ receiptId, amount: 200.02 }] });
    const second = structuredClone(f.state.fxRecords!.find(r => r.id === b));
    expect(mistMoneyMinor(mistFxLockUsage(f.state, lockId).remaining)).toBe(0);
    f.rejectUnchanged({ type: 'finance.fx.reverse', payload: { id: lockId, reason: '合同取消' } }, '先冲回相关结汇');
    f.run({ type: 'finance.fx.reverse', payload: { id: a, reason: '第一笔水单错误' } });
    expect(f.state.fxRecords!.find(r => r.id === b)).toEqual(second);
    expect(mistMoneyMinor(mistFxLockUsage(f.state, lockId).remaining)).toBe(10001);
    expect(mistReceiptSettledMinor(f.state, receiptId)).toBe(20002);
    expect(f.balance(f.usd)).toBe(10001); expect(f.balance(f.cny)).toBe(142014);
    expect(mistMoneyMinor(fxSettledAverage(f.state, 'USD')!.amount)).toBe(20002);
    f.rejectUnchanged({ type: 'finance.fx.reverse', payload: { id: a, reason: '再冲' } }, '已冲回');
    const corrected = f.settle(100.01, 710.07, 'SLIP-A', { lockId, receipts: [{ receiptId, amount: 100.01 }] });
    expect(mistMoneyMinor(mistFxLockUsage(f.state, lockId).remaining)).toBe(0);
    for (const id of [corrected, b, lockId]) f.run({ type: 'finance.fx.reverse', payload: { id, reason: '银行撤回' } });
    expect(mistReceiptSettledMinor(f.state, receiptId)).toBe(0);
    expect(f.balance(f.usd)).toBe(30003); expect(f.balance(f.cny)).toBe(0);
    expect(fxSettledAverage(f.state, 'USD')).toBeUndefined();
    expect(monthlyVouchers(f.state, '2026-10').some(l => l.summary.startsWith('结汇 '))).toBe(false);
  });

  it('累计结汇分配不能超过到账余额；创建与补分配失败均原子回滚，冲正后可重新分配', () => {
    const f = setup(), receiptId = f.receipt(100.03, 'LIMIT'); f.receipt(100, 'EXTRA');
    const a = f.settle(60.01, 426.07, 'LIMIT-A', { receipts: [{ receiptId, amount: 60.01 }] });
    const b = f.settle(50, 355, 'LIMIT-B');
    f.rejectUnchanged({ type: 'finance.fx.settle', payload: { date: '2026-10-10', fromAccountId: f.usd, toAccountId: f.cny,
      amount: 40.03, localAmount: 284.21, ref: 'LIMIT-C', receipts: [{ receiptId, amount: 40.03 }] } }, '未结汇余额');
    f.rejectUnchanged({ type: 'finance.fx.allocate', payload: { id: b, receipts: [{ receiptId, amount: 40.03 }] } }, '未结汇余额');
    f.run({ type: 'finance.fx.reverse', payload: { id: a, reason: '对应到账有误' } });
    f.run({ type: 'finance.fx.allocate', payload: { id: b, receipts: [{ receiptId, amount: 40.03 }] } });
    expect(mistReceiptSettledMinor(f.state, receiptId)).toBe(4003);
    expect(mistMoneyMinor(f.state.receipts.find(r => r.id === receiptId)!.remaining)).toBe(10003); // 结汇不占用应收核销余额。
  });
});

describe('已结账月份的冲正', () => {
  it.each(['payment', 'lock', 'settlement'] as const)('%s 冲正须先反结账，拒绝时所有记录不变', kind => {
    const f = setup(), receiptId = f.receipt(100.03, 'CLOSED'); f.invoice('i1', 100.03);
    f.run({ type: 'finance.reconcile', payload: { receiptId, invoiceId: 'i1', amount: 100.03 } });
    const paymentId = String(f.run({ type: 'finance.payment.save', payload: { accountId: f.usd, date: '2026-10-07', payee: '物流商', amount: 10.01, currency: 'USD', ref: 'PAY-1' } }).id);
    const lockId = f.lock(50), settlementId = f.settle(50, 355, 'CLOSED-FX');
    const command: MistCommand = kind === 'payment' ? { type: 'finance.payment.reverse', payload: { paymentId, reason: '录入有误' } }
        : { type: 'finance.fx.reverse', payload: { id: kind === 'lock' ? lockId : settlementId, reason: '录入有误' } };
    f.run({ type: 'finance.period.close', payload: { month: '2026-10', note: '核对一致' } });
    f.rejectUnchanged(command, '2026-10 已结账');
    f.run({ type: 'finance.period.reopen', payload: { month: '2026-10', reason: '更正原始记录' } });
    expect(() => f.run(command)).not.toThrow();
  });
});

describe('到账导入边界', () => {
  it('带参考号的同一流水在批内、重试及核销后均跳过，不同账户分别登记', () => {
    const f = setup(), row = { date: '2026-10-05', payer: ' Cedar ', amount: 0.03, currency: 'usd', ref: ' BANK-REF ' };
    const command: MistCommand = { type: 'finance.importReceipts', payload: { accountId: f.usd, receipts: [row, row] } };
    expect(f.run(command)).toEqual({ imported: 1, skipped: 1 });
    const receiptId = f.state.receipts[0].id; f.invoice('i1', 0.03);
    f.run({ type: 'finance.reconcile', payload: { receiptId, invoiceId: 'i1', amount: 0.03 } });
    expect(f.run(command)).toEqual({ imported: 0, skipped: 2 });
    expect(mistMoneyMinor(f.state.receipts[0].remaining)).toBe(0);
    const usd2 = f.account('USD', '4444');
    expect(f.run({ type: 'finance.importReceipts', payload: { accountId: usd2, receipts: [row] } })).toEqual({ imported: 1, skipped: 0 });
    expect(f.balance(f.usd)).toBe(3); expect(f.balance(usd2)).toBe(3);
  });

  it('批内后续流水无效时不保留已处理行；无参考号的两笔相同款项不擅自去重', () => {
    const f = setup(), row = { date: '2026-10-05', payer: 'Cedar', amount: 0.03, currency: 'USD', ref: '' };
    f.rejectUnchanged({ type: 'finance.importReceipts', payload: { accountId: f.usd, receipts: [row, { ...row, amount: 0.031 }] } }, '两位小数');
    expect(f.run({ type: 'finance.importReceipts', payload: { accountId: f.usd, receipts: [row, row] } })).toEqual({ imported: 2, skipped: 0 });
    expect(f.balance(f.usd)).toBe(6);
  });
});
