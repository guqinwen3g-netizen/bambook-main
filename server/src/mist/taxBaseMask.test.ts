/**
 * M1（2026-11 安全审查）：不持有 sensitive:tax_base 的账号，任何读取路径都不能得到或推算出
 * 进项税额、退税计税金额、应退 / 核准 / 到账退税额。逐条覆盖读投影出口。
 */
import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, mistCommandPermission, type MistCommand, type MistContext, type MistState } from '../shared/mistWorkspace';
import { orderRebate } from '../shared/mistExportRebate';
import { orderActualCost } from '../shared/mistOrderCost';
import { projectState } from './access';
import { agentGet, agentQuery } from './agentRead';
import { createAgentCommandAudit } from './agentAudit';
import { projectAgentAudit } from './agentAuditRead';

const FIN = ['invoices:read', 'invoices:write', 'invoices:reconcile', 'vouchers:read', 'vouchers:write', 'tax:read', 'tax:write', 'tax:approve', 'orders:read', 'procurement:read', 'customs:read', 'shipments:read', 'reports:admin', 'audit:read'];
const actor = (permissions: string[], id = 'reader'): any => ({ userId: id, displayName: id, roles: [], departmentIds: [], authorizationLoaded: true, permissions });
const empty = () => createMistState({ id: () => 'x', now: '2026-10-17T04:00:00Z', actorName: 't' }, 'empty');

/** 一张 113000 / 13000 的专票配单申报、核准 19000、国库到账 18800 并结清。 */
function filed() {
  let n = 0; const ctx: MistContext = { id: () => `tb-${++n}`, now: '2026-10-17T04:00:00Z', actorName: '林舒', actorId: 'demo-finance' };
  let state = createMistState(ctx, 'demo');
  state.exportRebate = { rates: [], claims: [] }; state.payables!.bills = [];
  const order = state.orders.find(o => o.code === 'SO-G-2026-017')!, line = state.orderLines.find(l => l.orderId === order.id)!;
  const customs = state.fulfillment.customs.find(c => state.fulfillment.shipments.find(s => s.id === c.shipmentId)?.state === 'departed')!;
  const po = { ...state.fulfillment.purchases[0], id: 'po-017', code: 'PC-017', orderId: order.id, lineId: line.id, kind: 'finished' as const, state: 'approved' as const };
  state.fulfillment.purchases.push(po);
  state.files.push({ id: 'vat-original', name: 'vat.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'test/vat', createdAt: ctx.now } as any);
  state.payables!.bills.push({ invoiceType: 'vat-special', id: 'b1', code: 'AP-b1', supplierId: po.supplierId, supplier: po.supplier, invoiceNo: '0451001', invoiceDate: '2026-10-10', currency: 'CNY', amount: 113000, taxAmount: 13000, taxRate: '13%',
    lines: [{ purchaseId: po.id, purchaseCode: po.code, kind: 'finished', amount: 113000 }], terms: [], due: '2026-11-10', dueBasis: '月结', fileIds: ['vat-original'], note: '', state: 'open', registeredAt: ctx.now, registeredBy: '林舒' });
  state.receipts.push({ id: 'r-tax', code: 'BR-TAX-01', date: '2026-10-16', payer: '国家金库上海分库', amount: 18800, remaining: 18800, currency: 'CNY', ref: '出口退税', state: 'unmatched' });
  const run = (command: MistCommand) => { const out = applyMistCommand(state, command, ctx); state = out.state; return out.result as { id: string }; };
  run({ type: 'rebate.rate.save', payload: { hsCode: '6203.31', rate: '13', effectiveFrom: '2020-03-20', basis: '公告' } } as MistCommand);
  const id = run({ type: 'rebate.claim.file', payload: { customsId: customs.id, billIds: ['b1'], filedAt: '2026-10-16', batchRef: 'SB-01' } } as MistCommand).id;
  run({ type: 'rebate.claim.approve', payload: { id, date: '2026-10-16', amount: 12000, ref: '核准 01', reason: '调减' } } as MistCommand);
  run({ type: 'rebate.claim.receive', payload: { id, receiptId: 'r-tax', amount: 11800, settle: true, reason: '扣抵' } } as MistCommand);
  return { state, order, id };
}
const SECRETS = ['13000', '12000', '11800', '13%', '13,000', '12,000', '11,800'];
const leaks = (value: unknown) => { const text = JSON.stringify(value); return SECRETS.filter(secret => new RegExp(`(?<![\\d.,])${secret.replace(/[.%]/g, m => '\\' + m)}(?![\\d,])`).test(text)); };

describe('M1 计税依据掩码：逐条出口', () => {
  const { state, order, id } = filed();
  const masked = projectState(state, actor(FIN), empty).state, full = projectState(state, actor([...FIN, 'sensitive:tax_base']), empty).state;

  it('读投影：票据去掉税率，申报核准额与到账勾稽额置零', () => {
    expect(masked.payables!.bills[0]).toMatchObject({ amount: 113000, taxAmount: 0, taxRate: '', taxMasked: true });
    const claim = masked.exportRebate!.claims.find(c => c.id === id)!;
    expect(claim).toMatchObject({ taxable: 0, expected: 0, taxMasked: true, approved: { amount: 0, ref: '核准 01' } });
    expect(claim.receipts.every(r => r.amount === 0)).toBe(true);
    expect(leaks(masked.payables)).toEqual([]); expect(leaks(masked.exportRebate)).toEqual([]);
    // 原状态不被改动；持码人看到原值
    expect(state.exportRebate!.claims.find(c => c.id === id)!.approved!.amount).toBe(12000);
    expect(full.exportRebate!.claims.find(c => c.id === id)!.approved!.amount).toBe(12000); expect(full.payables!.bills[0].taxRate).toBe('13%');
  });

  it('退税事件文字（含已入库的历史事件）在读投影时脱敏', () => {
    const raw = state.events.filter(e => e.entityType === 'rebate').map(e => e.text);
    expect(raw.some(text => /13000\.00 CNY/.test(text))).toBe(true);
    const shown = masked.events.filter(e => e.entityType === 'rebate').map(e => e.text);
    expect(shown.length).toBe(raw.length); expect(shown.some(text => text.includes('应退 已隐藏'))).toBe(true);
    expect(shown.filter(text => /\d[\d,.]*\s*CNY/.test(text))).toEqual([]);
    expect(full.events.filter(e => e.entityType === 'rebate').map(e => e.text)).toEqual(raw);
  });

  it('国库退税到账流水不下发，公司银行账户（余额可反推）一并隐藏', () => {
    expect(state.receipts.some(r => r.id === 'r-tax')).toBe(true);
    expect(masked.receipts.some(r => r.id === 'r-tax')).toBe(false);
    const result = projectState(state, actor([...FIN]), empty);
    expect(result.hidden.some(s => s.key === 'bankAccounts')).toBe(true); expect(result.state.bankAccounts).toEqual([]);
    expect(full.receipts.some(r => r.id === 'r-tax')).toBe(true);
  });

  it('订单退税与订单实际核算的汇总：按掩码后的投影计算不得出退税额', () => {
    expect(orderRebate(state, order.id)).toMatchObject({ expected: 13000, approved: 12000 });
    expect(orderRebate(masked, order.id)).toEqual({ expected: 0, approved: 0, received: 0 });
    const cost = orderActualCost(masked, order.id, 'period', '2026-10', '2026-10-17');
    expect(cost.rebate).toEqual({ expected: 0, approved: 0, received: 0, used: 0 });
  });

  it('标准 MCP / Agent 读取经同一读投影：票据与对象详情不含税额、税率', () => {
    const reader = actor(FIN);
    const bill = agentGet(masked, reader, 'payable_bill', 'b1');
    expect(bill.data).toMatchObject({ amount: 113000, taxAmount: 0, taxRate: '' }); expect(leaks(bill)).toEqual([]);
    expect(leaks(agentQuery(masked, reader, { type: 'payable_bill' }))).toEqual([]);
  });

  it('Agent 操作审计：原始填写中的税额、税率与核准额不回传；差异按掩码后的投影比对', async () => {
    const before = structuredClone(state), after = structuredClone(state);
    after.payables!.bills[0].note = '已核对';
    const register = createAgentCommandAudit({ workspaceId: 'w', requestId: 'op', at: '2026-10-17T04:00:00Z', actor: { id: 'reader', name: 'reader' }, source: 'agent', agentSessionId: 's', phase: 'executed',
      command: { type: 'payable.bill.register', payload: { supplierId: 's', invoiceNo: '0451001', amount: 113000, taxAmount: 13000, taxRate: '13%', lines: [] } }, requestedRevision: 0, baseRevision: 0, committedRevision: 1, before, after });
    const user = actor(FIN), project = (s: MistState) => projectState(s, user, empty).state;
    const view = (a: any, who = user) => projectAgentAudit(a, { actor: who, current: after, visible: project(after), project, permission: c => mistCommandPermission(c), unrestricted: true, offset: 0, limit: 50, includeCommand: true });
    const shown = view(register);
    expect(shown.command.payload).toMatchObject({ invoiceNo: '0451001', amount: 113000 }); expect(leaks(shown)).toEqual([]);
    const approveBefore = structuredClone(state), approveAfter = structuredClone(state); approveAfter.exportRebate!.claims[0].note = 'x';
    const approve = createAgentCommandAudit({ workspaceId: 'w', requestId: 'op2', at: '2026-10-17T04:00:00Z', actor: { id: 'reader', name: 'reader' }, source: 'agent', agentSessionId: 's', phase: 'proposed',
      command: { type: 'agent.proposal.create', payload: { command: { type: 'rebate.claim.approve', payload: { id, amount: 12000, ref: '核准 01' } } } }, requestedRevision: 0, baseRevision: 0, committedRevision: 1, before: approveBefore, after: approveAfter });
    expect(leaks(view(approve))).toEqual([]);
    // 提议说明（来自预演事件）随原始填写回传时按同一规则脱敏
    const reverse = createAgentCommandAudit({ workspaceId: 'w', requestId: 'op3', at: '2026-10-17T04:00:00Z', actor: { id: 'reader', name: 'reader' }, source: 'agent', agentSessionId: 's', phase: 'proposed',
      command: { type: 'agent.proposal.create', payload: { command: { type: 'rebate.claim.reverseReceipt', payload: { id, entryId: 'e', reason: '勾错' } }, summary: ['冲回退税到账勾稽 RC：流水 BR · 11800.00 CNY（勾错）'] } }, requestedRevision: 0, baseRevision: 0, committedRevision: 1, before: approveBefore, after: approveAfter });
    expect(leaks(view(reverse))).toEqual([]);
    const { maskTaxBaseInput } = await import('./access');
    expect(maskTaxBaseInput('agent.proposal.create', { command: { type: 'payable.x' }, summary: ['11800.00 CNY'] })).toEqual({ command: { type: 'payable.x' }, summary: ['11800.00 CNY'] });
    expect(maskTaxBaseInput('rebate.claim.reverseReceipt', { summary: ['冲回 11800.00 CNY'], amount: 11800, reason: 'x' })).toEqual({ summary: ['冲回 已隐藏'], reason: 'x' });
    // 持码人仍可看到原始填写
    const holder = actor([...FIN, 'sensitive:tax_base']), holderProject = (s: MistState) => projectState(s, holder, empty).state;
    const holderView = projectAgentAudit(register, { actor: holder, current: after, visible: holderProject(after), project: holderProject, permission: c => mistCommandPermission(c), unrestricted: true, offset: 0, limit: 50, includeCommand: true });
    expect(holderView.command.payload).toMatchObject({ taxAmount: 13000, taxRate: '13%' });
  });

  it('到账勾稽超额的错误提示不报出待到账金额（无 sensitive:tax_base 时）', () => {
    const { state: s0 } = filed(); const claim = s0.exportRebate!.claims[0];
    claim.state = 'approved'; claim.receipts = []; delete claim.settled; Object.assign(s0.receipts.find(r => r.id === 'r-tax')!, { amount: 99999, remaining: 99999 });
    const ctx = (can: string[]): MistContext => ({ id: () => 'e', now: '2026-10-17T04:00:00Z', actorName: 'x', actorId: 'x', can: scope => can.includes(scope) });
    const attempt = (can: string[]) => { try { applyMistCommand(structuredClone(s0), { type: 'rebate.claim.receive', payload: { id: claim.id, receiptId: 'r-tax', amount: 50000 } } as MistCommand, ctx(can)); return ''; } catch (e: any) { return String(e.message); } };
    expect(attempt([])).toContain('超过本申报待到账金额'); expect(leaks(attempt([]))).toEqual([]);
    expect(attempt(['sensitive:tax_base'])).toContain('12000.00 CNY');
  });

  it('读投影中已入库的退税提议说明脱敏，其他提议不动', () => {
    const s1 = structuredClone(state);
    s1.agentProposals = [{ id: 'p1', ownerId: 'reader', state: 'pending', command: { type: 'rebate.claim.reverseReceipt', payload: {} }, summary: ['冲回退税到账勾稽：11800.00 CNY'] } as any, { id: 'p2', ownerId: 'reader', state: 'pending', command: { type: 'payable.settlement.confirm', payload: {} }, summary: ['确认结算 110670.00 CNY'] } as any];
    const out = projectState(s1, actor(FIN), empty).state.agentProposals!;
    expect(out.find(p => p.id === 'p1')!.summary).toEqual(['冲回退税到账勾稽：已隐藏']);
    expect(out.find(p => p.id === 'p2')!.summary).toEqual(['确认结算 110670.00 CNY']);
    expect(projectState(s1, actor([...FIN, 'sensitive:tax_base']), empty).state.agentProposals!.find(p => p.id === 'p1')!.summary[0]).toContain('11800.00 CNY');
  });

  it('默认岗位中能申报、核准或勾稽退税的岗位都持有 sensitive:tax_base', async () => {
    const { DEFAULT_ROLE_PERMISSION_MATRIX } = await import('../_shared/rolePermissionMatrix');
    for (const [role, matrix] of Object.entries(DEFAULT_ROLE_PERMISSION_MATRIX)) {
      const m = matrix as Record<string, boolean>;
      if (m['tax:write'] || m['tax:approve'] || (m['invoices:reconcile'] && m['tax:read'])) expect([role, m['sensitive:tax_base']]).toEqual([role, true]);
    }
  });

  it('通知与待办：退税命令不产生含金额的通知或待办', () => {
    expect(leaks(masked.notifications)).toEqual([]); expect(leaks(masked.tasks)).toEqual([]);
  });
});
