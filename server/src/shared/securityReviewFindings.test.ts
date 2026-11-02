// Security review findings for codex/p0-security (2026-11-02). These cases fail until the finding is fixed:
// H1 two approval levels signed by one person, M1 tax base recoverable from amount and rate, H3 high-risk command run directly over MCP.
// Keep them; once a finding is fixed, the case must pass. See docs/GO-LIVE.md (handoff 2026-11-02 15:00).
import { describe, it, expect } from 'vitest';
import { applyMistCommand, createMistState, type MistContext, type MistState } from './mistWorkspace';
import { payableBills } from './mistPayables';
import { maskTaxBase } from '../mist/access';
import { agentCommandSensitivity } from '../mist/agentMcp';
import { agentCommandRisk } from './mistAgentProposals';

let seq = 0;
const ctx = (actor: string, extra: object = {}) => ({ id: () => 'x-' + (++seq), now: '2026-10-14T02:00:00.000Z', actorName: actor, actorId: actor, ...extra }) as MistContext;
// 生产里总领导同时是 pay_gt5 / pay_new_supplier 的唯一审批人（context.ts 上抬逻辑），这里按同样形状给出。
const AUTH = { authority: { supplier: {}, paymentTierReviewerIds: { pay_lt5: ['主管'], pay_gt5: ['总经理'], pay_new_supplier: ['总经理'] } } };
const as = (actor: string, s: MistState, command: any) => applyMistCommand(s, command, ctx(actor, AUTH));

describe('付款两级审批', () => {
  it('首笔大额付款：两级应由不同的人签，不能由同一人连签两次放行', () => {
    const state = createMistState(ctx('财务'), 'demo'); state.payables!.bills = []; state.payables!.payments = [];
    const po = state.fulfillment.purchases.find(p => p.code === 'PO-2026-00001')!;
    let s = applyMistCommand(state, { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'VAT-9', invoiceDate: '2026-10-10', currency: 'CNY', amount: 60000, taxAmount: 0, lines: [{ purchaseId: po.id, amount: 60000 }], due: '2026-10-30', dueBasis: '验收后' } } as any, ctx('财务')).state;
    const bill = payableBills(s, '2026-10-14')[0];
    const req = as('业务', s, { type: 'payable.request.submit', payload: { purpose: 'bill', supplierId: po.supplierId, currency: 'CNY', lines: [{ billId: bill.id, amount: 60000 }], reason: '付款' } });
    const id = String(req.result.id); s = req.state;
    expect(s.payables!.requests!.find(r => r.id === id)!.tier!.levels.map(l => l.level)).toEqual(['pay_gt5', 'pay_new_supplier']);
    s = as('总经理', s, { type: 'payable.request.decide', payload: { id, decision: 'approved', note: '同意' } }).state;
    let second = '';
    try { s = as('总经理', s, { type: 'payable.request.decide', payload: { id, decision: 'approved', note: '再签' } }).state; } catch (e: any) { second = e.message; }
    // 期望：第二级被拒绝（同一人已签过一级）。实际：同一人签完两级，申请变成 approved。
    expect(second).not.toBe('');
    expect(s.payables!.requests!.find(r => r.id === id)!.state).toBe('pending');
  });
});

describe('计税金额掩码', () => {
  it('掩码后不应能用 价税合计 与 税率 还原税额', () => {
    const next: any = { payables: { bills: [{ id: 'b', amount: 113000, taxAmount: 13000, taxRate: '13%' }] }, exportRebate: { rates: [], claims: [{ id: 'c', taxable: 100000, expected: 13000, lines: [], approved: { amount: 13000 }, receipts: [] }] } };
    maskTaxBase(next);
    const b = next.payables.bills[0];
    expect(b.taxAmount).toBe(0);
    // 失败点 1：taxRate 与 amount 原样保留，113000 × 13/113 = 13000
    expect(b.taxRate === '' || b.amount === 0).toBe(true);
    // 失败点 2：核准金额 approved.amount 原样保留（通常等于应退税额）
    expect(next.exportRebate.claims[0].approved.amount).toBe(0);
  });
});

describe('Agent 直接执行', () => {
  it('未登记（按高风险）的命令不应能经 MCP 可办理委托直接执行而绕过 ai:write:high 与密码复验', () => {
    for (const type of ['order.create', 'cost.expense.payable', 'market.quotation.convert', 'fulfillment.inventory.quarantine.dispose', 'platform.claim.create']) {
      expect(agentCommandRisk(type)).toBe('high');
      expect(agentCommandSensitivity(type)).toBe('confirm');
    }
  });
});
