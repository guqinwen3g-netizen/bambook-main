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
  // 生产默认岗位下总领导同时是 pay_gt5 / pay_new_supplier 的原路由审批人（context.ts 上抬逻辑）；
  // 有第二位合格领导时 context.ts 以 paymentTierAlternateIds 给出。两种情况都不能由同一人连签两级放行。
  const setup = () => {
    const state = createMistState(ctx('财务'), 'demo'); state.payables!.bills = []; state.payables!.payments = [];
    const po = state.fulfillment.purchases.find(p => p.code === 'PO-2026-00001')!;
    const s = applyMistCommand(state, { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'VAT-9', invoiceDate: '2026-10-10', currency: 'CNY', amount: 60000, taxAmount: 0, lines: [{ purchaseId: po.id, amount: 60000 }], due: '2026-10-30', dueBasis: '验收后' } } as any, ctx('财务')).state;
    return { s, po, bill: payableBills(s, '2026-10-14')[0] };
  };
  const submit = (f: ReturnType<typeof setup>, auth: object) => applyMistCommand(f.s, { type: 'payable.request.submit', payload: { purpose: 'bill', supplierId: f.po.supplierId, currency: 'CNY', lines: [{ billId: f.bill.id, amount: 60000 }], reason: '付款' } } as any, ctx('业务', auth));
  const tryRun = (fn: () => unknown) => { try { fn(); return ''; } catch (e: any) { return e.message as string; } };
  it('首笔大额付款：两级只能由同一人签时提交被拒绝', () => {
    expect(tryRun(() => submit(setup(), AUTH))).toContain('缺少第二位审批人');
  });
  it('首笔大额付款：有第二位合格审批人时，同一人第二次签被拒绝、申请保持 pending，另一人签后才 approved', () => {
    const auth = { authority: { ...AUTH.authority, paymentTierAlternateIds: { pay_lt5: [], pay_gt5: ['总监'], pay_new_supplier: [] } } };
    const req = submit(setup(), auth), id = String(req.result.id);
    let s = req.state;
    expect(s.payables!.requests!.find(r => r.id === id)!.tier!.levels.map(l => l.level)).toEqual(['pay_gt5', 'pay_new_supplier']);
    const decide = (who: string, st: MistState, note: string) => applyMistCommand(st, { type: 'payable.request.decide', payload: { id, decision: 'approved', note } } as any, ctx(who, auth));
    s = decide('总经理', s, '同意').state;
    const second = tryRun(() => { s = decide('总经理', s, '再签').state; });
    expect(second).not.toBe('');
    expect(s.payables!.requests!.find(r => r.id === id)!.state).toBe('pending');
    s = decide('总监', s, '同意').state;
    expect(s.payables!.requests!.find(r => r.id === id)!.state).toBe('approved');
    expect(new Set(s.payables!.requests!.find(r => r.id === id)!.approvals!.map(a => a.actorId)).size).toBe(2);
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
  it('中 / 高风险命令不应能经 MCP 可办理委托直接执行而绕过 ai:write:* 与高风险密码复验', () => {
    // 等级依据用户 2026-11-02 定案：付款、核销、审批为高风险（cost.expense.payable 生成应付；隔离料报废处置按复核裁定为高）；其余普通业务写入为中风险。
    const expected: Record<string, string> = { 'order.create': 'medium', 'cost.expense.payable': 'high', 'market.quotation.convert': 'medium', 'fulfillment.inventory.quarantine.dispose': 'high', 'platform.claim.create': 'medium' };
    for (const [type, risk] of Object.entries(expected)) {
      expect([type, agentCommandRisk(type)]).toEqual([type, risk]);
      expect(agentCommandSensitivity(type)).toBe('confirm');
    }
  });
});
