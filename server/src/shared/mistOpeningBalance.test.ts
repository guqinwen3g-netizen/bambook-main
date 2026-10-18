import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from './mistWorkspace';
import { MIST_DEMO_ACCOUNTS } from './mistAccounts';
import { customerStatementContent } from './mistCustomerStatement';
import { teamRow } from './mistTeam';
import { mistInvoiceCustomerId } from './mistOpeningBalance';
import { billOpenMinor } from './mistPayables';

function fixture() {
  let i = 0; const ctx = { id: () => `ob-${++i}`, now: '2026-10-18T02:00:00Z', actorName: '周敏', actorId: 'demo-reviewer', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext;
  let state = createMistState(ctx, 'empty');
  const run = (command: { type: string; payload: unknown }) => { const r = applyMistCommand(state, command as MistCommand, ctx); state = r.state; return r.result as any; };
  run({ type: 'market.import', payload: { kind: 'customer', rows: [{ code: 'C-NW', name: 'Nordic Wear AB', currency: 'USD', owner: '顾言' }, { code: 'C-BY', name: '博远纺织', currency: 'CNY' }] } });
  return { run, get state() { return state as MistState; } };
}
const row = (over: Record<string, string> = {}) => ({ customer: 'C-NW', reference: 'CI-2026-0815', issuedAt: '2026-08-15', due: '2026-09-14', currency: 'usd', originalAmount: '48,000', amount: '33600', note: '定金已收', ...over });

describe('期初未结应收', () => {
  it('权限为开票权；市场导入不接受期初类型', () => {
    expect(mistCommandPermission({ type: 'opening.receivable.import', payload: { rows: [] } } as unknown as MistCommand)).toBe('invoices:write');
    expect(mistCommandPermission({ type: 'opening.receivable.void', payload: { invoiceId: 'x', reason: 'y' } } as unknown as MistCommand)).toBe('invoices:write');
    expect(() => mistCommandPermission({ type: 'market.import', payload: { kind: 'openingReceivable', rows: [] } } as unknown as MistCommand)).toThrow('导入类型无效');
  });
  it('按客户编码登记未收余额，归属客户、已确认，进入对账单、团队逾期与核销', () => {
    const f = fixture();
    expect(f.run({ type: 'opening.receivable.import', payload: { rows: [row(), row({ customer: '博远纺织', reference: 'FP-0001', currency: 'CNY', originalAmount: '', amount: '12000.50', due: '2026-11-30' })] } }).imported).toBe(2);
    const [usd, cny] = f.state.invoices;
    const customer = f.state.customers.find(c => c.code === 'C-NW')!;
    expect(usd).toMatchObject({ code: 'CI-2026-0815', orderId: '', customer: 'Nordic Wear AB', customerId: customer.id, amount: 33600, open: 33600, currency: 'USD', issuedAt: '2026-08-15', financeStatus: 'confirmed', opening: { originalAmount: 48000, note: '定金已收' } });
    expect(cny).toMatchObject({ amount: 12000.5, opening: { originalAmount: 12000.5 } });
    expect(mistInvoiceCustomerId(f.state, usd)).toBe(customer.id);
    const statement = customerStatementContent(f.state, customer.id, '2026-10-18');
    expect(statement.sections[0].lines[0]).toMatchObject({ code: 'CI-2026-0815', reference: '期初', open: '33600.00' });
    expect(teamRow(f.state, { id: 'demo-sales', name: '顾言' }, '2026-10-18').receivables.map(r => r.code)).toEqual(['CI-2026-0815']);
    // 到账核销
    f.state.receipts.push({ id: 'r1', code: 'RCV-1', date: '2026-10-17', payer: 'Nordic Wear AB', amount: 10000, remaining: 10000, currency: 'USD', ref: '', state: 'unmatched' } as any);
    f.run({ type: 'finance.reconcile', payload: { receiptId: 'r1', invoiceId: usd.id, amount: 10000 } });
    expect(f.state.invoices[0].open).toBe(23600);
    expect(() => f.run({ type: 'opening.receivable.void', payload: { invoiceId: usd.id, reason: '录错' } })).toThrow('须先冲回核销');
  });
  it('逐行校验：客户、重复发票号、日期、金额；整批不导入', () => {
    const f = fixture();
    let message = '';
    try { f.run({ type: 'opening.receivable.import', payload: { rows: [
      row(), row(),
      row({ reference: 'A2', customer: '不存在' }),
      row({ reference: 'A3', issuedAt: '2026-10-19' }),
      row({ reference: 'A4', due: '2026-08-01' }),
      row({ reference: 'A5', amount: '50000' }),
      row({ reference: 'A6', amount: '0' }),
      row({ reference: 'A7', amount: '1.234' }),
    ] } }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('共 7 行不通过');
    expect(message).toContain('第 3 行：发票号 CI-2026-0815 已存在');
    expect(message).toContain('第 4 行：客户“不存在”未建档');
    expect(message).toContain('第 5 行：开票日期不能晚于今天');
    expect(message).toContain('第 6 行：到期日不能早于开票日期');
    expect(message).toContain('第 7 行：未收余额不能大于票面金额');
    expect(message).toContain('第 8 行：未收余额须大于 0');
    expect(message).toContain('第 9 行：未收余额须为最多两位小数');
    expect(f.state.invoices).toHaveLength(0);
  });
  it('作废：须填原因，只限期初登记，作废后不计余额，不可重复', () => {
    const f = fixture();
    f.run({ type: 'opening.receivable.import', payload: { rows: [row()] } });
    const id = f.state.invoices[0].id;
    expect(() => f.run({ type: 'opening.receivable.void', payload: { invoiceId: id, reason: ' ' } })).toThrow('请填写作废原因');
    f.run({ type: 'opening.receivable.void', payload: { invoiceId: id, reason: '金额录错，重登' } });
    expect(f.state.invoices[0]).toMatchObject({ voidReason: '金额录错，重登', voidedBy: '周敏', open: 0 });
    expect(() => f.run({ type: 'opening.receivable.void', payload: { invoiceId: id, reason: 'x' } })).toThrow('已作废');
    // 作废的登记保留原号留痕，重登须换号
    expect(() => f.run({ type: 'opening.receivable.import', payload: { rows: [row()] } })).toThrow('重登请加后缀');
    expect(f.run({ type: 'opening.receivable.import', payload: { rows: [row({ reference: 'CI-2026-0815-R' })] } }).imported).toBe(1);
  });
  it('期初应付：按供应商编码登记未付余额，可按票据付款与作废', () => {
    const f = fixture();
    f.run({ type: 'market.import', payload: { kind: 'supplier', rows: [{ code: 'SUP-001', name: '江南成衣厂', type: '成衣', capabilities: '外套', capacity: '1000', capacityUnit: '件/月', leadDays: '30' }] } });
    const ap = (over: Record<string, string> = {}) => ({ supplier: 'sup-001', invoiceNo: '3301-881', invoiceDate: '2026-09-05', due: '2026-10-05', currency: 'cny', originalAmount: '113,000', taxAmount: '13000', amount: '60000', note: '已付 53000', ...over });
    expect(f.run({ type: 'opening.payable.import', payload: { rows: [ap(), ap({ supplier: '江南成衣厂', invoiceNo: '3301-882', originalAmount: '', taxAmount: '', amount: '500' })] } }).imported).toBe(2);
    const [bill, small] = (f.state as any).payables.bills;
    expect(bill).toMatchObject({ code: 'AP-2026-0001', supplier: '江南成衣厂', invoiceNo: '3301-881', currency: 'CNY', amount: 60000, taxAmount: 13000, lines: [], state: 'open', opening: { originalAmount: 113000 } });
    expect(small).toMatchObject({ code: 'AP-2026-0002', amount: 500, taxAmount: 0, opening: { originalAmount: 500 } });
    expect(billOpenMinor(f.state as any, bill)).toBe(6000000);
    let message = '';
    try { f.run({ type: 'opening.payable.import', payload: { rows: [ap(), ap({ invoiceNo: 'X1', supplier: '无此厂' }), ap({ invoiceNo: 'X2', taxAmount: '200000' }), ap({ invoiceNo: 'X3', invoiceDate: '2026-12-01', due: '2026-12-31' })] } }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('第 2 行：该供应商的发票号 3301-881 已登记过');
    expect(message).toContain('第 3 行：供应商“无此厂”未建档');
    expect(message).toContain('第 4 行：税额不能大于价税合计');
    expect(message).toContain('第 5 行：发票日期不能晚于今天');
    f.run({ type: 'payable.bill.void', payload: { id: small.id, reason: '录错' } });
    expect((f.state as any).payables.bills[1].state).toBe('void');
  });
});
