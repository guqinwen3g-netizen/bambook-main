// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getAllByRole, getByRole, getByLabelText, getByText, queryByRole, queryAllByRole } from '@testing-library/dom';
import { MistRoot, ToastProvider } from '../../../../components/mist';
import { createMistState, applyMistCommand } from '../../../../server/src/shared/mistWorkspace';
import { platformBusinessDate } from '../../../../server/src/shared/mistPlatform';
import { MIST_FINANCE_SCOPES } from '../../../../server/src/shared/mistFinancePermissions';
import { PAYMENT_REQUEST_SCOPES, SETTLEMENT_SCOPES } from '../../../../server/src/shared/mistPayables';
import { Nav } from '../nav';
const store = vi.hoisted(() => ({ value: null as any }));
vi.mock('../runtime/workspace', () => ({ useMistWorkspace: () => store.value }));
vi.mock('../runtime/auth', () => { const useMistSession = () => ({ user:{id:store.value?.userId||'finance'}, hasPermission: (scope: string) => store.value?.canWrite !== false && (!store.value?.permissions || store.value.permissions.includes(scope)) }); return { useMistSession, useOptionalMistSession: useMistSession }; });
import { FinancePayables } from './FinancePayables';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLElement, root: Root, route: { view: string; id?: string; section?: string };
const go = vi.fn(), day = platformBusinessDate(new Date());
function render() { act(() => root.render(<MistRoot><ToastProvider><Nav.Provider value={{ route, go, theme: 'light', toggleTheme: vi.fn(), openAI: vi.fn(), openPalette: vi.fn() } as any}><FinancePayables /></Nav.Provider></ToastProvider></MistRoot>)); }
const click = async (name: string | RegExp, scope: HTMLElement = document.body) => { await act(async () => (getAllByRole(scope, 'button', { name })[0] as HTMLButtonElement).click()); };
function input(label: string, value: string) { const c = getByLabelText(document.body, label) as HTMLInputElement; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(c, value); c.dispatchEvent(new Event('input', { bubbles: true })); }); }
function select(label: string, value: string) { const c = getByLabelText(document.body, label) as HTMLSelectElement; act(() => { c.value = value; c.dispatchEvent(new Event('change', { bubbles: true })); }); }
let po: any, ctx: any;
beforeEach(() => {
  let serial = 0; const context = ctx = { id: () => `ui-${++serial}`, actorName: '财务', actorId: 'finance', now: new Date().toISOString(), authority: { supplier: {}, paymentReviewerIds: ['manager'] } };
  const state = createMistState(context, 'demo'); state.payables!.bills = []; /* 演示自带出口退税专票；本组从没有票据开始 */ po = state.fulfillment.purchases.find(p => p.code === 'PO-2026-00001');
  store.value = { state, workspace: { id: 'space' }, loading: false, saving: false, pending: null, run: vi.fn(async (command: any) => { const r = applyMistCommand(store.value.state, command, context); store.value.state = r.state; render(); return { requestId: 'req', revision: 1, result: r.result }; }) };
  go.mockReset(); route = { view: 'payment-vouchers', section: 'payables' };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('opens the purchaser work item at its fixed contract without selecting receipts or final settlement on their behalf',async()=>{
  prepaidWithReceipt();store.value.userId='sales';store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;const before=structuredClone(store.value.state);render();
  const form=getByRole(document.body,'dialog',{name:'提交结算'}),contract=getByLabelText(form,'结算合同') as HTMLSelectElement;
  expect(contract.value).toBe(po.id);expect(contract.disabled).toBe(true);expect([...contract.options].every(o=>!o.value||o.value===po.id)).toBe(true);
  expect([...form.querySelectorAll('input[type="checkbox"]')].every(e=>!(e as HTMLInputElement).checked)).toBe(true);expect(store.value.state).toEqual(before);expect(store.value.run).not.toHaveBeenCalled();
  await click('取消',form);expect(go).toHaveBeenLastCalledWith('payment-vouchers',undefined,{section:'payables'});
});

it('does not open a settlement write form from a contract URL without submit permission',()=>{
  prepaidWithReceipt();store.value.permissions=[MIST_FINANCE_SCOPES.invoice];route.id=po.id;render();expect(queryByRole(document.body,'dialog',{name:'提交结算'})).toBeNull();expect(queryByRole(host,'button',{name:'提交结算'})).toBeNull();
});

it('does not replace an unavailable work-item contract with another approved contract',()=>{
  prepaidWithReceipt();store.value.permissions=[SETTLEMENT_SCOPES.submit];store.value.state.fulfillment.purchases.find((p:any)=>p.id===po.id).state='cancelled';route.id=po.id;render();
  const form=getByRole(document.body,'dialog',{name:'提交结算'});expect(form.textContent).toContain('来源合同已不可用');expect((getByRole(form,'button',{name:'提交复核'}) as HTMLButtonElement).disabled).toBe(true);expect(store.value.run).not.toHaveBeenCalled();
});

it('opens a routed settlement after workspace facts load and after navigating from another payable tab',async()=>{
 const state=store.value.state;state.payables.settlements=[{id:'handoff-settlement',code:'ST-HANDOFF',purchaseId:po.id,purchaseCode:po.code,supplierId:po.supplierId,supplier:po.supplier,currency:po.currency,unit:po.unit,price:po.price,receiptIds:[],quantity:1,rejected:0,amount:po.price,final:false,disputes:[],note:'原结算依据',fileIds:[],state:'pending',submitterId:'business',submittedBy:'业务员',submittedAt:ctx.now}];route.id='handoff-settlement';store.value.state=null;render();store.value.state=state;render();expect(getByRole(host,'table',{name:'供应商结算'})).toBeTruthy();expect(host.querySelector('[data-settlement="handoff-settlement"]')).toBeTruthy();await click(/^应付票据 ·/);expect(getByRole(host,'table',{name:'应付票据'})).toBeTruthy();state.payables.settlements.push({...state.payables.settlements[0],id:'another-settlement',code:'ST-ANOTHER'});route={...route,id:'another-settlement'};render();expect(getByRole(host,'table',{name:'供应商结算'})).toBeTruthy();expect(host.querySelector('[data-settlement="another-settlement"]')).toBeTruthy();
});

it('从待登记来源登记供应商票据：形成应付，合同还没收到票的金额同步减少', async () => {
  render(); expect(host.textContent).toContain('暂无供应商票据');
  await click(/待登记来源/); const row = getByRole(host, 'table', { name: '待登记来源合同' });
  expect(row.textContent).toContain('111,600.00 CNY');
  await click('登记票据', row);
  const dialog = getByRole(document.body, 'dialog', { name: '登记供应商票据' });
  expect((getByLabelText(dialog, po.code + ' 本票金额') as HTMLInputElement).value).toBe('111600');
  expect(dialog.querySelector('[data-bill-source]')?.classList.contains('mist-module-actions')).toBe(true);
  input(po.code + ' 本票金额', '33480'); input('供应商发票号', 'VAT-HS-01'); input('税额', '3851.68'); input('到期日', day);
  expect((getByLabelText(dialog, '到期日依据') as HTMLInputElement).value).toContain(po.terms);
  await click('登记应付', dialog);
  expect(store.value.run).toHaveBeenCalledWith(expect.objectContaining({ type: 'payable.bill.register', payload: expect.objectContaining({ supplierId: po.supplierId, currency: 'CNY', amount: 33480, taxAmount: 3851.68, lines: [{ purchaseId: po.id, amount: 33480 }] }) }));
  expect(store.value.state.payables.bills[0]).toMatchObject({ invoiceNo: 'VAT-HS-01', amount: 33480 });
  expect(getByRole(host, 'table', { name: '供应商应付汇总' }).textContent).toContain('33,480.00 CNY');
  expect(go).toHaveBeenLastCalledWith('payment-vouchers', store.value.state.payables.bills[0].id, { section: 'payables' }, { keepScroll: true });
});

it('有付款的票据不能作废，按钮写明原因；没有付款的作废要写原因', async () => {
  store.value.state = applyMistCommand(store.value.state, { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'V-9', invoiceDate: day, currency: 'CNY', amount: 50, taxAmount: 0, lines: [{ purchaseId: po.id, amount: 50 }], due: day, dueBasis: '测试' } } as any, { id: () => 'b' + Math.random(), now: new Date().toISOString(), actorName: '财务' }).state;
  const bill = store.value.state.payables.bills[0]; route = { view: 'payment-vouchers', section: 'payables', id: bill.id }; render();
  await click('作废票据'); const dialog = getByRole(document.body, 'dialog', { name: '作废供应商票据' });
  expect((getByRole(dialog, 'button', { name: '确认作废' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => { const t = getByLabelText(dialog, '作废原因') as HTMLTextAreaElement; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, '供应商开错金额'); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('确认作废', dialog);
  expect(store.value.state.payables.bills[0]).toMatchObject({ state: 'void', voided: { reason: '供应商开错金额' } });
});

function text(label: string, value: string, scope: HTMLElement = document.body) { const t = getByLabelText(scope, label) as HTMLTextAreaElement; act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, value); t.dispatchEvent(new Event('input', { bubbles: true })); }); }
const reg = (no: string, amount: number) => { let n = 0; store.value.state = applyMistCommand(store.value.state, { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: no, invoiceDate: day, currency: 'CNY', amount, taxAmount: 0, lines: [{ purchaseId: po.id, amount }], due: day, dueBasis: '测试' } } as any, { id: () => no + '-' + (++n), now: new Date().toISOString(), actorName: '财务' } as any).state; };
/** 主管在审批收件箱批准（服务端审批入口，界面外）。 */
const approve = (id: string) => { store.value.state = applyMistCommand(store.value.state, { type: 'payable.request.decide', payload: { id, decision: 'approved', note: '核对后同意' } } as any, { id: () => 'decide-' + id, now: new Date().toISOString(), actorName: '主管', actorId: 'manager', authority: { supplier: {}, paymentReviewerIds: ['manager'] } } as any).state; };
const dialog = (name: string) => getByRole(document.body, 'dialog', { name });

it('票据付款：先申请并经主管批准，再按批准登记实付；分配错误可冲回后重新分配', async () => {
  reg('A-1', 300); reg('A-2', 200); render();
  const [a, b] = store.value.state.payables.bills;
  expect(queryAllByRole(host, 'button', { name: '登记供应商付款' })).toHaveLength(0);
  await click('申请票据付款');
  select('收款供应商', po.supplierId);
  expect(dialog('申请票据付款').querySelector('[data-pay-bill]')?.classList.contains('mist-module-actions')).toBe(true);
  input(a.code + ' 申请金额', '300'); input(b.code + ' 申请金额', '250');
  await click('提交审批', dialog('申请票据付款'));
  expect(store.value.run).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('不能超过可申请金额');
  input(b.code + ' 申请金额', '100');
  await click('提交审批', dialog('申请票据付款'));
  expect(document.body.textContent).toContain('请填写付款依据'); expect(store.value.run).not.toHaveBeenCalled();
  text('付款依据', '两张票均已到期，按合同 30 天付款');
  await click('提交审批', dialog('申请票据付款'));
  const req = store.value.state.payables.requests[0];
  expect(req).toMatchObject({ state: 'pending', amount: 400, reviewerIds: ['manager'] });
  route = { view: 'payment-vouchers', section: 'payables', id: req.id }; render();
  expect(host.textContent).toContain('等待主管审批'); expect(queryAllByRole(host, 'button', { name: '登记实付' })).toHaveLength(0);
  approve(req.id); render();
  await click('登记实付');
  const pay = dialog('按已批准申请登记实付');
  expect((getByLabelText(pay, a.code + ' 分配金额') as HTMLInputElement).readOnly).toBe(true);
  input('银行流水号', 'BK-1');
  await click('登记实付', pay);
  expect(store.value.state.payables.requests[0].state).toBe('paid');
  expect(store.value.state.payables.allocations).toHaveLength(2);
  expect(store.value.state.payments.at(-1)).toMatchObject({ payee: po.supplier, amount: 400, ref: 'BK-1' });
  const payment = store.value.state.payables.payments[0];
  route = { view: 'payment-vouchers', section: 'payables', id: payment.id }; render();
  await click('冲回分配');
  expect((getByRole(dialog('冲回分配'), 'button', { name: '确认冲回' }) as HTMLButtonElement).disabled).toBe(true);
  text('冲回原因', 'A-1 金额分错', dialog('冲回分配')); await click('确认冲回', dialog('冲回分配'));
  expect(store.value.state.payables.reversals).toHaveLength(1);
  expect(host.textContent).toContain('付款待分配');
  await click('分配到应付'); input(b.code + ' 分配金额', '100'); await click('确认分配');
  expect(store.value.state.payables.allocations).toHaveLength(3);
});

it('预付款：财务按合同登记计划，申请经主管批准后实付，挂在合同上；登记错误可冲回，申请回到已批准待付', async () => {
  render();
  await click('登记付款计划');
  select('来源合同', po.id); input('计划金额', '33480'); input('付款触发条件', '合同回签后 7 天内');
  expect((getByLabelText(document.body, '合同条款依据') as HTMLInputElement).value).toContain('合同付款条件');
  await click('登记计划', dialog('登记付款计划'));
  const plan = store.value.state.payables.plans[0];
  expect(plan).toMatchObject({ purchaseId: po.id, amount: 33480, trigger: '合同回签后 7 天内' });
  expect(host.textContent).toContain(plan.code);expect(host.textContent).not.toContain('计划不是应付');
  await click('申请预付款');
  input('申请金额', '33480.01'); text('付款依据', '合同已于本周回签');
  await click('提交审批', dialog('申请预付款'));
  expect(document.body.textContent).toContain('超过该计划剩余可申请金额');
  input('申请金额', '33480'); await click('提交审批', dialog('申请预付款'));
  const req = store.value.state.payables.requests[0]; expect(req).toMatchObject({ purpose: 'prepayment', state: 'pending' });
  approve(req.id); route = { view: 'payment-vouchers', section: 'payables', id: req.id }; render();
  await click('登记实付'); expect(dialog('按已批准申请登记实付').textContent).toContain('不分配到票据');
  input('银行流水号', 'BK-PRE'); await click('登记实付', dialog('按已批准申请登记实付'));
  const payment = store.value.state.payables.payments[0];
  expect(payment).toMatchObject({ purpose: 'prepayment', purchaseId: po.id });
  route = { view: 'payment-vouchers', section: 'payables', id: payment.id }; render();
  expect(host.textContent).toContain('合同预付款'); expect(queryAllByRole(host, 'button', { name: '分配到应付' })).toHaveLength(0);
  await click('付款冲回'); text('冲回原因', '流水号录错', dialog('付款冲回')); await click('确认冲回', dialog('付款冲回'));
  expect(host.textContent).toContain('已冲回');
  expect(store.value.state.payables.requests[0].state).toBe('approved');
  expect(store.value.state.payments.at(-1).amount).toBe(-33480);
});

it('没有财务写权限：保留查看，隐藏登记和申请入口', async () => {
  store.value.canWrite = false; render();
  for (const name of ['登记供应商票据', '登记付款计划', '提交结算', '申请票据付款']) expect(queryByRole(host, 'button', { name })).toBeNull();
  await click(/待登记来源/); expect(getByRole(host, 'table', { name: '待登记来源合同' }).textContent).toContain(po.code);expect(queryByRole(host,'button',{name:'登记票据',exact:true})).toBeNull();
  expect(store.value.run).not.toHaveBeenCalled();
});

function approvedBillRequest() {
  reg('PERMISSION-VAT', 100); const bill = store.value.state.payables.bills[0];
  store.value.state = applyMistCommand(store.value.state, { type: 'payable.request.submit', payload: { purpose: 'bill', supplierId: po.supplierId, currency: 'CNY', lines: [{ billId: bill.id, amount: 100 }], reason: '到期' } } as any, { id: () => 'perm-req', now: new Date().toISOString(), actorName: '业务', actorId: 'sales', authority: { supplier: {}, paymentReviewerIds: ['manager'] } } as any).state;
  approve('perm-req'); return { bill, request: store.value.state.payables.requests[0] };
}
it('只有付款登记权限、没有核销权时，隐藏票据复合付款入口', async () => {
  const { request } = approvedBillRequest();
  store.value.permissions = ['vouchers:write', 'invoices:read', 'vouchers:read'];
  route = { view: 'payment-vouchers', section: 'payables', id: request.id }; render();
  expect(queryByRole(host, 'button', { name: '登记实付' })).toBeNull();
  expect(store.value.run).not.toHaveBeenCalled();
});
it('打开登记实付后失去核销权限，不能提交附带分配的复合付款', async () => {
  const { request } = approvedBillRequest();
  route = { view: 'payment-vouchers', section: 'payables', id: request.id }; render();
  await click('登记实付'); input('银行流水号', 'STALE-SCOPE');
  store.value.permissions = ['vouchers:write']; render();
  await click('登记实付', dialog('按已批准申请登记实付'));
  expect(store.value.run).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('没有办理此项财务动作的权限');
});

const as = (actorId: string, actorName: string, command: any) => { let n = 0; const r = applyMistCommand(store.value.state, command, { id: () => `${actorId}-${command.type}-${++n}-${Math.random()}`, now: new Date().toISOString(), actorName, actorId, authority: { supplier: {}, paymentReviewerIds: ['manager'] } } as any); store.value.state = r.state; return r.result; };

it('结算：业务员按收货提交，财务确认预付抵扣（与建议不同须写原因），再按结算登记票据，应付扣除预付', async () => {
  as('finance', '财务', { type: 'payable.plan.register', payload: { purchaseId: po.id, amount: 33480, trigger: '合同签订后 7 天内', basis: '合同第 5 条' } });
  const req = as('sales', '业务', { type: 'payable.request.submit', payload: { purpose: 'prepayment', planId: store.value.state.payables.plans[0].id, amount: 33480, reason: '按合同申请预付' } });
  approve(String(req.id));
  as('finance', '财务', { type: 'payable.payment.register', payload: { requestId: req.id, date: day, amount: 33480, reference: 'BK-PP' } });
  store.value.state.fulfillment.receipts.push({ id: 'rcpt-ui', purchaseId: po.id, quantity: 1000, rejected: 50, destination: 'warehouse', location: '嘉兴仓', date: day, evidence: '收货单', fileIds: [], actor: '仓库', createdAt: new Date().toISOString() });
  render();
  // 已付预付后，未确认结算的合同不能直接登记票据。
  await click(/待登记来源/); await click('登记票据', getByRole(host, 'table', { name: '待登记来源合同' }));
  expect([...(getByLabelText(dialog('登记供应商票据'), po.code + ' 关联结算') as HTMLSelectElement).options].map(o => o.textContent)).toEqual(['请选择结算', '待关联结算']);
  await click('取消', dialog('登记供应商票据'));
  ctx.actorId = 'sales'; ctx.actorName = '业务';
  await click('提交结算'); const sd = dialog('提交结算');
  select('结算合同', po.id);
  const box = getByRole(sd, 'checkbox', { name: /嘉兴仓 · 实收 1000/ }) as HTMLInputElement;
  await act(async () => box.click());
  expect(sd.textContent).toContain('建议抵扣');expect(sd.textContent).toContain('13,950.00');
  await click('添加争议 / 扣款', sd); input('争议说明 1', '色差待确认扣款'); input('争议金额 1', '500');
  await click('提交复核', dialog('提交结算'));
  const st = store.value.state.payables.settlements[0];
  expect(st).toMatchObject({ state: 'pending', receiptIds: ['rcpt-ui'], submitterId: 'sales', disputes: [{ description: '色差待确认扣款', amount: 500 }] });
  ctx.actorId = 'finance'; ctx.actorName = '财务';
  route = { view: 'payment-vouchers', section: 'payables', id: st.id }; render();
  expect(host.textContent).toContain('等待财务复核');
  await click('确认结算'); const cd = dialog('确认结算');
  expect((getByLabelText(cd, '本次预付抵扣') as HTMLInputElement).value).toBe('13950');
  input('本次预付抵扣', '14000'); input('调整原因', '供应商同意首批多抵 50 元');
  await click('确认结算', dialog('确认结算'));
  expect(store.value.state.payables.settlements[0]).toMatchObject({ state: 'confirmed', confirmation: { suggestedPrepayment: 13950, prepaymentApplied: 14000, adjustReason: '供应商同意首批多抵 50 元' } });
  await click('按结算登记票据'); const bd = dialog('登记供应商票据');
  expect((getByLabelText(bd, po.code + ' 关联结算') as HTMLSelectElement).value).toBe(st.id);
  expect((getByLabelText(bd, po.code + ' 本票金额') as HTMLInputElement).value).toBe('46500');
  input('供应商发票号', 'VAT-ST-1'); input('税额', '0'); input('到期日', day);
  await click('登记应付', bd);
  const bill = store.value.state.payables.bills[0];
  expect(bill.lines[0]).toMatchObject({ purchaseId: po.id, amount: 46500, settlementId: st.id });
  route = { view: 'payment-vouchers', section: 'payables', id: bill.id }; render();
  expect(host.textContent).toContain('预付抵扣（来自结算）'); expect(host.textContent).toContain('14,000.00');
  expect(host.textContent).toContain('32,500.00');
  await click(/^供应商付款 · /);
  expect(getByRole(host, 'table', { name: '供应商付款' }).textContent).toContain('预付 · 部分已抵扣');
});

/** 已付预付的样例合同：33,480 预付，收货 1000 米（拒收 50）。 */
function prepaidWithReceipt() {
  as('finance', '财务', { type: 'payable.plan.register', payload: { purchaseId: po.id, amount: 33480, trigger: '合同签订后 7 天内', basis: '合同第 5 条' } });
  const req = as('sales', '业务', { type: 'payable.request.submit', payload: { purpose: 'prepayment', planId: store.value.state.payables.plans[0].id, amount: 33480, reason: '按合同申请预付' } });
  approve(String(req.id));
  as('finance', '财务', { type: 'payable.payment.register', payload: { requestId: req.id, date: day, amount: 33480, reference: 'BK-PP' } });
  store.value.state.fulfillment.receipts.push({ id: 'rcpt-ui', purchaseId: po.id, quantity: 1000, rejected: 50, destination: 'warehouse', location: '嘉兴仓', date: day, evidence: '收货单', fileIds: [], actor: '仓库', createdAt: new Date().toISOString() });
}

it('发票先到：登记为待关联结算并暂挂，汇总单列；结算确认后在票据详情关联结算，才能申请付款', async () => {
  prepaidWithReceipt(); render();
  await click(/待登记来源/); await click('登记票据', getByRole(host, 'table', { name: '待登记来源合同' }));
  const bd = dialog('登记供应商票据');
  input(po.code + ' 本票金额', '46500'); select(po.code + ' 关联结算', '__held'); input('供应商发票号', 'VAT-EARLY'); input('到期日', day);
  await click('登记应付', bd);
  const bill = store.value.state.payables.bills[0];
  expect(bill.lines[0]).toMatchObject({ awaitingSettlement: true });
  expect(getByRole(host, 'table', { name: '供应商应付汇总' }).textContent).toContain('1 张待关联结算（46,500.00 CNY）');
  expect(host.textContent).toContain('结算确认后关联。');
  expect((getAllByRole(host, 'button', { name: '申请付款' })[0] as HTMLButtonElement).disabled).toBe(true);
  const st = as('sales', '业务', { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: ['rcpt-ui'] } });
  as('finance', '财务', { type: 'payable.settlement.confirm', payload: { id: st.id, prepaymentApplied: 13950 } });
  render();
  await click('关联结算'); const ld = dialog('关联结算');
  expect((getByLabelText(ld, po.code + ' 关联结算') as HTMLSelectElement).value).toBe(st.id);
  await click('确认关联', ld);
  expect(store.value.state.payables.bills[0].lines[0]).toMatchObject({ settlementId: st.id });
  expect(host.textContent).not.toContain('结算确认后关联。');
  expect(host.textContent).toContain('13,950.00');
  expect((getAllByRole(host, 'button', { name: '申请付款' })[0] as HTMLButtonElement).disabled).toBe(false);
});

function confirmedWithEarlyBill(part=1){
 prepaidWithReceipt();store.value.state.fulfillment.receipts.find((r:any)=>r.id==='rcpt-ui').quantity=po.quantity;
 const gross=Math.round(po.quantity*po.price*100)/100;
 const bill=as('finance','财务',{type:'payable.bill.register',payload:{supplierId:po.supplierId,invoiceType:'commercial',invoiceNo:'INV-0528',invoiceDate:day,currency:po.currency,amount:gross*part,taxAmount:0,taxRate:'',lines:[{purchaseId:po.id,amount:gross*part,awaitingSettlement:true}],due:day,dueBasis:'验收后支付',fileIds:[]}});
 const settlement=as('sales','业务',{type:'payable.settlement.submit',payload:{purchaseId:po.id,receiptIds:['rcpt-ui'],final:true}});
 as('finance','财务',{type:'payable.settlement.confirm',payload:{id:settlement.id,prepaymentApplied:33480}});route.id=String(settlement.id);return{bill,settlement,gross};
}
it('从结算直接关联已到票据，不引导重复登记或生成第二张票据',async()=>{
 const{bill,settlement}=confirmedWithEarlyBill();render();expect(queryByRole(document.body,'button',{name:'按结算登记票据'})).toBeNull();expect(host.textContent).toContain('待关联票据');expect(host.textContent).toContain('INV-0528');await click(/关联结算/);const form=dialog('关联结算');expect((getByLabelText(form,po.code+' 关联结算') as HTMLSelectElement).value).toBe(settlement.id);await click('确认关联',form);
 expect(store.value.state.payables.bills).toHaveLength(1);expect(store.value.state.payables.bills[0]).toMatchObject({id:bill.id,lines:[expect.objectContaining({settlementId:settlement.id})]});expect(store.value.run).toHaveBeenCalledWith(expect.objectContaining({type:'payable.bill.link',payload:{id:bill.id,links:[{purchaseId:po.id,settlementId:settlement.id}]}}));
});
it('已到部分票据时保留登记余票和关联已有票据两个入口',()=>{
 confirmedWithEarlyBill(.5);render();expect(queryByRole(document.body,'button',{name:'按结算登记票据'})).toBeTruthy();expect(queryByRole(document.body,'button',{name:/关联结算/})).toBeTruthy();expect(store.value.run).not.toHaveBeenCalled();
});
it('只读结算保留已到票据事实，不显示关联或登记动作',()=>{
 confirmedWithEarlyBill();store.value.permissions=['invoices:read','vouchers:read'];render();expect(host.textContent).toContain('待关联票据');expect(host.textContent).toContain('INV-0528');expect(queryByRole(document.body,'button',{name:/关联结算/})).toBeNull();expect(queryByRole(document.body,'button',{name:'按结算登记票据'})).toBeNull();expect(store.value.run).not.toHaveBeenCalled();
});
it('已作废票据不占用结算登记入口，也不作为待关联票据显示',()=>{
 const{bill}=confirmedWithEarlyBill();as('finance','财务',{type:'payable.bill.void',payload:{id:bill.id,reason:'重开票据'}});render();expect(queryByRole(document.body,'button',{name:'按结算登记票据'})).toBeTruthy();expect(host.textContent).not.toContain('待关联票据');expect(queryByRole(document.body,'button',{name:/关联结算/})).toBeNull();
});

it('索赔扣款：工厂同意从货款中扣的追偿在票据上登记扣款，扣满自动落实；可冲回', async () => {
  reg('V-CL', 5000);
  const bill = store.value.state.payables.bills[0];
  store.value.state.platform = { ...(store.value.state.platform || {}), claims: [{ id: 'claim-ui', code: 'CL-2026-0042', state: 'Open', coordination: { notices: [], verifications: [], recoveries: [{ id: 'rec-ui', supplierId: po.supplierId, supplierName: po.supplier, currency: 'CNY', requested: 800, basis: '色差', state: 'Agreed', agreed: 800, method: 'deduction', agreedNote: '邮件', createdAt: '', createdBy: '业务', createdById: 'sales', events: [] }] } }] } as any;
  route = { view: 'payment-vouchers', section: 'payables', id: bill.id }; render();
  await click('登记索赔扣款'); const dd = dialog('登记索赔扣款');
  expect((getByLabelText(dd, '扣款金额') as HTMLInputElement).value).toBe('800');
  input('扣款依据', 'DN-2026-01');
  await click('登记扣款', dd);
  const rec = store.value.state.platform.claims[0].coordination.recoveries[0];
  expect(rec).toMatchObject({ state: 'Settled', settled: 800 });
  expect(host.textContent).toContain('索赔扣款'); expect(host.textContent).toContain('4,200.00 CNY');
  await click('冲回扣款'); text('冲回原因', '扣款通知作废'); await click('确认冲回', dialog('冲回索赔扣款'));
  expect(store.value.state.platform.claims[0].coordination.recoveries[0].state).toBe('Agreed');
  expect(store.value.state.payables.deductions[0].reversed).toMatchObject({ reason: '扣款通知作废' });
});

it('短交最终结算后剩余预付：在结算详情登记退款，可冲回', async () => {
  prepaidWithReceipt();
  const st = as('sales', '业务', { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: ['rcpt-ui'], final: true } });
  as('finance', '财务', { type: 'payable.settlement.confirm', payload: { id: st.id, prepaymentApplied: 33480 } });
  // 结算 46,500 已抵扣全部预付；再造一笔小额最终结算场景：用新合同数据验证剩余
  route = { view: 'payment-vouchers', section: 'payables', id: st.id }; render();
  expect(host.textContent).toContain('合同预付去向');
  expect(queryAllByRole(host, 'button', { name: '登记退款' })).toHaveLength(0);
  as('finance', '财务', { type: 'payable.settlement.reverse', payload: { id: st.id, reason: '改为小额结算' } });
  store.value.state.fulfillment.receipts.push({ id: 'rcpt-small', purchaseId: po.id, quantity: 500, rejected: 0, destination: 'warehouse', location: '嘉兴仓', date: day, evidence: '收货单', fileIds: [], actor: '仓库', createdAt: new Date().toISOString() });
  const st2 = as('sales', '业务', { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: ['rcpt-small'], final: true } });
  as('finance', '财务', { type: 'payable.settlement.confirm', payload: { id: st2.id, prepaymentApplied: 23250 } });
  route = { view: 'payment-vouchers', section: 'payables', id: st2.id }; render();
  expect(host.textContent).toContain('最终结算后仍有剩余预付');
  await click('登记退款'); const rd = dialog('登记剩余预付退款');
  expect((getByLabelText(rd, '退款金额') as HTMLInputElement).value).toBe('10230');
  input('退款流水号', 'TT-BACK'); text('退款说明', '供应商退回短交预付', rd);
  await click('登记退款', rd);
  expect(store.value.state.payables.prepaymentMoves[0]).toMatchObject({ kind: 'refund', amount: 10230, reference: 'TT-BACK' });
  expect((getAllByRole(host, 'button', { name: '冲回结算' })[0] as HTMLButtonElement).disabled).toBe(true);
  await click('冲回', host.querySelector('[data-prepayment-move]') as HTMLElement); text('冲回原因', '流水录错'); await click('确认冲回', dialog('冲回剩余预付处理'));
  expect(store.value.state.payables.prepaymentMoves[0].reversed).toMatchObject({ reason: '流水录错' });
});

const actAs = (actorId: string, command: any) => { let n = 0; const r = applyMistCommand(store.value.state, command, { id: () => `${actorId}-${Date.now()}-${++n}`, now: new Date().toISOString(), actorName: actorId, actorId, authority: { supplier: {}, paymentReviewerIds: ['manager'] } } as any); store.value.state = r.state; return r.result as any; };

it('不等票付款：已确认结算可写明未收票原因申请先付，经批准登记后显示已付未收票', async () => {
  const receipt = store.value.state.fulfillment.receipts.find((r: any) => r.purchaseId === po.id);
  const st = actAs('sales', { type: 'payable.settlement.submit', payload: { purchaseId: po.id, receiptIds: [receipt.id] } });
  actAs('finance', { type: 'payable.settlement.confirm', payload: { id: st.id, prepaymentApplied: 0 } });
  const amount = store.value.state.payables.settlements[0].amount;
  route = { view: 'payment-vouchers', section: 'payables', id: st.id }; render();
  expect(host.textContent).toContain('不等票可申请');
  await click('不等票申请付款');
  const d = dialog('不等票申请付款');
  expect((getByLabelText(d, '不等票申请金额') as HTMLInputElement).value).toBe(String(amount));
  await click('提交审批', d);
  expect(store.value.run).not.toHaveBeenCalled(); expect(d.textContent).toContain('未收票');
  input('不等票申请金额', '1000'); text('未收票原因', '工厂开票慢，货已验收', d);
  await click('提交审批', d);
  expect(store.value.run).toHaveBeenCalledWith(expect.objectContaining({ type: 'payable.request.submit', payload: expect.objectContaining({ purpose: 'settlement', settlementId: st.id, amount: 1000 }) }));
  const req = store.value.state.payables.requests[0]; approve(req.id);
  route = { view: 'payment-vouchers', section: 'payables', id: req.id }; render();
  expect(host.textContent).toContain('按结算付款（发票未到）');
  await click('登记实付'); expect(dialog('按已批准申请登记实付').textContent).toContain('自动抵到票据'); input('银行流水号', 'BANK-ADV'); await click('登记实付', dialog('按已批准申请登记实付'));
  expect(store.value.state.payables.payments[0]).toMatchObject({ purpose: 'settlement', settlementId: st.id, amount: 1000 });
  expect(getByRole(host, 'table', { name: '供应商应付汇总' }).textContent).toContain('已付未收票');
  await click(/供应商付款 ·/);
  expect(getByRole(host, 'table', { name: '供应商付款' }).textContent).toContain('已付未收票');
  const cashBeforeBackfill=structuredClone(store.value.state.payments);
  const bill = actAs('finance', { type: 'payable.bill.register', payload: { supplierId: po.supplierId, invoiceNo: 'VAT-LATE', invoiceDate: '2026-10-15', currency: po.currency, amount, taxAmount: 0, lines: [{ purchaseId: po.id, amount, settlementId: st.id }], due: '2026-11-14', dueBasis: '月结' } });
  route = { view: 'payment-vouchers', section: 'payables', id: bill.id }; render();
  expect(host.textContent).toContain('先付抵扣（不等票付款）');const detail=host.querySelector('[data-payable-bill="'+bill.id+'"]') as HTMLElement;expect(getByText(detail,'已结清 / 未付')).toBeTruthy();expect(getByText(detail,'1,000.00 CNY / '+(amount-1000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' CNY')).toBeTruthy();expect(detail.textContent).not.toContain('直接付款分配');expect(getByRole(host,'table',{name:'供应商应付汇总'}).textContent).toContain('已结清');expect(store.value.state.payments).toEqual(cashBeforeBackfill);
});

it('历史付款补登：计划详情按凭证补登，不走审批，记为历史补登', async () => {
  actAs('finance', { type: 'payable.plan.register', payload: { purchaseId: po.id, amount: 5000, trigger: '签约后', basis: '合同第 5 条' } });
  const plan = store.value.state.payables.plans[0];
  route = { view: 'payment-vouchers', section: 'payables', id: plan.id }; render();
  await click('历史付款补登'); const d = dialog('历史付款补登');
  await click('确认补登', d); expect(d.textContent).toContain('凭证号');
  input('实际付款日期', '2026-09-01'); input('付款凭证号', 'V-089'); input('补登金额', '3000');
  await click('确认补登', d);
  expect(store.value.run).toHaveBeenCalledWith(expect.objectContaining({ type: 'payable.payment.backfill', payload: expect.objectContaining({ planId: plan.id, amount: 3000, reference: 'V-089', date: '2026-09-01' }) }));
  expect(store.value.state.payables.payments[0]).toMatchObject({ backfill: true, purpose: 'prepayment', planId: plan.id });
  expect(store.value.state.payables.requests).toHaveLength(0);
  expect(host.textContent).toContain('历史补登（系统上线前已付，未走申请）');
});

it('票据登记可上传发票附件，详情可下载', async () => {
  store.value.uploadFile = vi.fn(async (file: File) => { const f = { id: 'file-vat', name: file.name, mimeType: file.type, size: 1, storageKey: 'k', createdAt: ctx.now }; store.value.state.files.push(f); return f; });
  store.value.downloadFile = vi.fn();
  render(); await click(/待登记来源/); await click('登记票据', getByRole(host, 'table', { name: '待登记来源合同' }));
  const dialog = getByRole(document.body, 'dialog', { name: '登记供应商票据' });
  input(po.code + ' 本票金额', '33480'); input('供应商发票号', 'VAT-HS-02'); input('税额', '3851.68'); input('到期日', day);
  const file = dialog.querySelector('input[type="file"]') as HTMLInputElement; const pdf = new File(['x'], '增值税发票.pdf', { type: 'application/pdf' }); Object.defineProperty(file, 'files', { value: [pdf] });
  await act(async () => { file.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(dialog.textContent).toContain('增值税发票.pdf');
  await click('登记应付', dialog);
  expect(store.value.state.payables.bills[0].fileIds).toEqual(['file-vat']);
  expect(host.textContent).toContain('发票附件'); expect(host.textContent).toContain('增值税发票.pdf');
});

it('核对票种保留原金额与付款记录，失败后保留原件和核对依据以便重试',async()=>{
 store.value.state.files.push({id:'vat-proof',name:'原发票.pdf',mimeType:'application/pdf',size:10,storageKey:'test/vat-proof',createdAt:ctx.now});
 const added=applyMistCommand(store.value.state,{type:'payable.bill.register',payload:{supplierId:po.supplierId,invoiceNo:'CLASSIFY-01',invoiceDate:day,currency:'CNY',amount:1130,taxAmount:130,lines:[{purchaseId:po.id,amount:1130}],due:day,dueBasis:'按合同',fileIds:['vat-proof']}},ctx);
 store.value.state=added.state;route.id=added.result.id!;render();await click('核对票种');
 select('发票类型','vat-special');const note=getByRole(document.body,'textbox',{name:'核对依据'}) as HTMLTextAreaElement;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(note,'票号、日期及金额与原件一致');note.dispatchEvent(new Event('input',{bubbles:true}));});
 store.value.run.mockRejectedValueOnce(new Error('连接中断'));await click('保存',getByRole(document.body,'dialog',{name:'核对票种'}));
 expect(getByRole(document.body,'dialog',{name:'核对票种'}).textContent).toContain('连接中断');expect(note.value).toBe('票号、日期及金额与原件一致');
 await click('保存',getByRole(document.body,'dialog',{name:'核对票种'}));
 expect(store.value.state.payables.bills[0]).toMatchObject({invoiceType:'vat-special',amount:1130,taxAmount:130,fileIds:['vat-proof']});expect(store.value.state.payables.allocations).toEqual([]);
 expect(host.textContent).toContain('增值税专用发票');expect(queryAllByRole(document.body,'dialog',{name:'核对票种'})).toHaveLength(0);
});

it('只读财务账号不能打开票种核对',()=>{
 const added=applyMistCommand(store.value.state,{type:'payable.bill.register',payload:{supplierId:po.supplierId,invoiceNo:'READ-ONLY',invoiceDate:day,currency:'CNY',amount:100,taxAmount:0,lines:[{purchaseId:po.id,amount:100}],due:day,dueBasis:'按合同'}},ctx);
 store.value.state=added.state;route.id=added.result.id!;store.value.canWrite=false;render();expect(queryByRole(host,'button',{name:'核对票种'})).toBeNull();expect(store.value.run).not.toHaveBeenCalled();
});

function planFixture(){
 const made=applyMistCommand(store.value.state,{type:'payable.plan.register',payload:{purchaseId:po.id,stage:'prepayment',amount:100,trigger:'合同确认后',basis:'合同约定预付',due:day}} as any,ctx);store.value.state=made.state;return made.result.id!;
}
function prepayRequestFixture(){
 const planId=planFixture(),made=applyMistCommand(store.value.state,{type:'payable.request.submit',payload:{purpose:'prepayment',planId,amount:100,reason:'合同已确认'}} as any,{...ctx,actorId:'sales',actorName:'业务员'});store.value.state=made.state;return store.value.state.payables.requests.find((r:any)=>r.id===made.result.id)!;
}
it('业务只有申请及采购经办权限时仍可申请预付，不能管理票据计划或登记实付',async()=>{
 const planId=planFixture();store.value.permissions=[PAYMENT_REQUEST_SCOPES.create,SETTLEMENT_SCOPES.submit,'invoices:read','vouchers:read'];store.value.userId='sales';ctx.actorId='sales';ctx.actorName='业务员';route.id=planId;render();
 expect(queryByRole(host,'button',{name:'登记供应商票据'})).toBeNull();expect(queryByRole(host,'button',{name:'登记付款计划'})).toBeNull();expect(queryByRole(host,'button',{name:'历史付款补登'})).toBeNull();expect(queryByRole(host,'button',{name:'取消计划'})).toBeNull();
 expect((getByRole(host,'button',{name:'提交结算'}) as HTMLButtonElement).disabled).toBe(false);
 await click('申请预付款');text('付款依据','按已确认合同预付');await click('提交审批',dialog('申请预付款'));
 expect(store.value.state.payables.requests[0]).toMatchObject({purpose:'prepayment',requesterId:'sales',state:'pending',amount:100});expect(queryByRole(host,'button',{name:'登记实付'})).toBeNull();
});
it('付款登记和核销权限独立：只有付款登记权仍可登记无票据分配的预付款',async()=>{
 const request=prepayRequestFixture();approve(request.id);store.value.permissions=[MIST_FINANCE_SCOPES.voucher,'invoices:read','vouchers:read'];route.id=request.id;render();
 expect((getByRole(host,'button',{name:'登记实付'}) as HTMLButtonElement).disabled).toBe(false);expect(queryByRole(host,'button',{name:'撤回申请'})).toBeNull();expect(store.value.run).not.toHaveBeenCalled();
});
it('只给申请人本人显示撤回，当前申请权限撤回后入口消失',()=>{
 const request=prepayRequestFixture();store.value.permissions=[PAYMENT_REQUEST_SCOPES.create,'invoices:read','vouchers:read'];store.value.userId='other-sales';route.id=request.id;render();
 expect(host.textContent).toContain(request.code);expect(queryByRole(host,'button',{name:'撤回申请'})).toBeNull();
 store.value.userId='sales';render();expect((getByRole(host,'button',{name:'撤回申请'}) as HTMLButtonElement).disabled).toBe(false);
 store.value.permissions=['invoices:read','vouchers:read'];render();expect(queryByRole(host,'button',{name:'撤回申请'})).toBeNull();expect(store.value.run).not.toHaveBeenCalled();
});
it('只读付款计划保留金额与合同事实，不显示写操作及权限教学',()=>{
 const planId=planFixture();store.value.permissions=['invoices:read','vouchers:read'];route.id=planId;render();
 expect(host.textContent).toContain('计划金额');expect(host.textContent).toContain(po.code);
 for(const name of ['申请预付款','历史付款补登','取消计划'])expect(queryByRole(host,'button',{name})).toBeNull();
 expect(host.textContent).not.toContain('需要票据登记权限');expect(host.textContent).not.toContain('计划不是应付');expect(store.value.run).not.toHaveBeenCalled();
});

it('shows full-quantity settlement as final before submission and presents the money as fields',async()=>{
 prepaidWithReceipt();store.value.state.fulfillment.receipts.find((r:any)=>r.id==='rcpt-ui').quantity=po.quantity;store.value.permissions=[SETTLEMENT_SCOPES.submit];store.value.userId='sales';route.id=po.id;render();
 const form=getByRole(document.body,'dialog',{name:'提交结算'}),receipt=form.querySelector('[data-settle-receipt="rcpt-ui"] input') as HTMLInputElement;
 await act(async()=>receipt.click());const final=getByLabelText(form,'最终结算') as HTMLInputElement;expect(final.checked).toBe(true);expect(final.disabled).toBe(true);expect(form.textContent).toContain('合同单价');expect(form.textContent).toContain('建议抵扣');expect(store.value.run).not.toHaveBeenCalled();
});
it('does not reopen a completed final settlement as a writable work item',()=>{
 prepaidWithReceipt();const settlement=as('sales','业务',{type:'payable.settlement.submit',payload:{purchaseId:po.id,receiptIds:['rcpt-ui'],final:true}});as('finance','财务',{type:'payable.settlement.confirm',payload:{id:settlement.id,prepaymentApplied:33480}});store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;render();
 const form=getByRole(document.body,'dialog',{name:'提交结算'});expect(form.textContent).toContain('合同已完成最终结算');expect((getByRole(form,'button',{name:'提交复核'}) as HTMLButtonElement).disabled).toBe(true);expect(store.value.run).not.toHaveBeenCalled();
});
it('explains a pending finance review instead of permitting duplicate settlement submission',()=>{
 prepaidWithReceipt();as('sales','业务',{type:'payable.settlement.submit',payload:{purchaseId:po.id,receiptIds:['rcpt-ui']}});store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;render();
 const form=getByRole(document.body,'dialog',{name:'提交结算'});expect(form.textContent).toContain('已有待财务复核结算');expect((getByRole(form,'button',{name:'提交复核'}) as HTMLButtonElement).disabled).toBe(true);expect(store.value.run).not.toHaveBeenCalled();
});

it.each(['success','failure'] as const)('does not apply a prior contract %s response to the next settlement editor',async outcome=>{
 prepaidWithReceipt();const state=store.value.state;state.fulfillment.purchases.push({...po,id:'next-contract',code:'PO-NEXT'});state.fulfillment.receipts.push({id:'next-receipt',purchaseId:'next-contract',quantity:1,rejected:0,date:day,location:'成品仓'});store.value.permissions=[SETTLEMENT_SCOPES.submit];store.value.userId='sales';route.id=po.id;
 let resolve!:(value:any)=>void,reject!:(error:Error)=>void;store.value.run.mockImplementationOnce(()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));render();let form=getByRole(document.body,'dialog',{name:'提交结算'});await act(async()=>form.querySelector<HTMLInputElement>('[data-settle-receipt="rcpt-ui"] input')!.click());await click('提交复核',form);
 route={...route,id:'next-contract'};render();await act(async()=>outcome==='success'?resolve({requestId:'prior',revision:2,result:{id:'previous-settlement'}}):reject(new Error('上一合同的迟到失败')));
 form=getByRole(document.body,'dialog',{name:'提交结算'});expect((getByLabelText(form,'结算合同') as HTMLSelectElement).value).toBe('next-contract');expect(form.textContent).not.toContain('上一合同的迟到失败');expect(go).not.toHaveBeenCalledWith('payment-vouchers','previous-settlement',expect.anything(),expect.anything());
});
it('retains settlement receipt choices and notes during a same-contract refresh',async()=>{
 prepaidWithReceipt();store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;render();let form=getByRole(document.body,'dialog',{name:'提交结算'});await act(async()=>form.querySelector<HTMLInputElement>('[data-settle-receipt="rcpt-ui"] input')!.click());text('结算说明','明细已核对',form);store.value.state=structuredClone(store.value.state);render();form=getByRole(document.body,'dialog',{name:'提交结算'});expect((getByLabelText(form,'结算说明') as HTMLTextAreaElement).value).toBe('明细已核对');expect(form.querySelector<HTMLInputElement>('[data-settle-receipt="rcpt-ui"] input')!.checked).toBe(true);expect(store.value.run).not.toHaveBeenCalled();
});

it('shows transferred-in prepayment even when this contract has no direct prepayment',()=>{prepaidWithReceipt();store.value.state.payables.payments=[];store.value.state.payables.prepaymentMoves.push({id:'incoming',code:'PM-IN',kind:'transfer',purchaseId:'another',purchaseCode:'PO-FROM',targetPurchaseId:po.id,targetPurchaseCode:po.code,supplierId:po.supplierId,supplier:po.supplier,currency:po.currency,amount:1000,date:day,reference:'对账依据',reason:'同供应商转抵',at:ctx.now,actor:'财务'});store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;render();const form=getByRole(document.body,'dialog',{name:'提交结算'});expect(form.textContent).toContain('转入预付');expect(form.textContent).toContain('1,000.00');expect(store.value.run).not.toHaveBeenCalled();});

it('recovers a lost settlement response inside the locked dialog without submitting again',async()=>{
 prepaidWithReceipt();store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;
 store.value.run=vi.fn(async(command:any)=>{const result=applyMistCommand(store.value.state,command,ctx);store.value.state=result.state;store.value.pending={kind:'command',workspaceId:'space',requestId:'lost',actorId:'finance',command};render();throw Object.assign(new Error('网络连接中断'),{mistPendingCommand:{workspaceId:'space',requestId:'lost',actorId:'finance'}});});
 store.value.recover=vi.fn(async()=>{const id=store.value.state.payables.settlements[0].id;store.value.pending=null;render();return{requestId:'lost',revision:2,result:{id}};});render();
 let form=getByRole(document.body,'dialog',{name:'提交结算'});await act(async()=>form.querySelector<HTMLInputElement>('[data-settle-receipt="rcpt-ui"] input')!.click());await click('提交复核',form);
 form=getByRole(document.body,'dialog',{name:'提交结算'});expect(queryByRole(form,'button',{name:'提交复核'})).toBeNull();expect(getByLabelText(form,'结算说明').matches(':disabled')).toBe(true);
 await click('核对原操作结果',form);expect(store.value.recover).toHaveBeenCalledOnce();expect(store.value.run).toHaveBeenCalledOnce();expect(store.value.state.payables.settlements).toHaveLength(1);expect(queryByRole(document.body,'dialog',{name:'提交结算'})).toBeNull();expect(go).toHaveBeenLastCalledWith('payment-vouchers',store.value.state.payables.settlements[0].id,{section:'payables'},{keepScroll:true});
});

it('shows settlement actions only to the responsible purchaser or finance role',()=>{
 prepaidWithReceipt();const result=as('sales','业务',{type:'payable.settlement.submit',payload:{purchaseId:po.id,receiptIds:['rcpt-ui']}});route.id=result.id;
 store.value.userId='sales';store.value.permissions=[SETTLEMENT_SCOPES.submit];render();expect(queryByRole(document.body,'button',{name:'确认结算'})).toBeNull();expect(queryByRole(document.body,'button',{name:'退回结算'})).toBeNull();expect(queryByRole(document.body,'button',{name:'撤回结算'})).toBeTruthy();expect(document.body.textContent).not.toContain('需要核销权限');
 store.value.userId='another-sales';render();expect(queryByRole(document.body,'button',{name:'撤回结算'})).toBeNull();
 store.value.userId='finance';store.value.permissions=[SETTLEMENT_SCOPES.confirm];render();expect(queryByRole(document.body,'button',{name:'撤回结算'})).toBeNull();expect((getByRole(document.body,'button',{name:'确认结算'}) as HTMLButtonElement).disabled).toBe(false);
});

it('opens the exact recovered settlement after a reload without recreating or resubmitting the draft',async()=>{
 prepaidWithReceipt();store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;const command={type:'payable.settlement.submit',payload:{purchaseId:po.id,receiptIds:['rcpt-ui']}};
 const result=as('sales','业务',command);store.value.userId='sales';store.value.pending={kind:'command',workspaceId:'space',requestId:'restored',actorId:'sales',command};store.value.recover=vi.fn(async()=>{store.value.pending=null;render();return{requestId:'restored',revision:2,result};});render();
 const form=getByRole(document.body,'dialog',{name:'提交结算'});await click('核对原操作结果',form);expect(store.value.run).not.toHaveBeenCalled();expect(store.value.state.payables.settlements).toHaveLength(1);expect(queryByRole(document.body,'dialog',{name:'提交结算'})).toBeNull();expect(go).toHaveBeenLastCalledWith('payment-vouchers',result.id,{section:'payables'},{keepScroll:true});
});

it('retains the recovery action after another network failure and does not navigate a new contract to the old result',async()=>{
 prepaidWithReceipt();store.value.permissions=[SETTLEMENT_SCOPES.submit];route.id=po.id;
 store.value.run=vi.fn(async(command:any)=>{store.value.pending={kind:'command',workspaceId:'space',requestId:'lost',actorId:'finance',command};render();throw Object.assign(new Error('网络连接中断'),{mistPendingCommand:{workspaceId:'space',requestId:'lost',actorId:'finance'}});});
 let resolve!:Function;store.value.recover=vi.fn().mockRejectedValueOnce(new Error('仍未连接')).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));render();
 let form=getByRole(document.body,'dialog',{name:'提交结算'});await act(async()=>form.querySelector<HTMLInputElement>('[data-settle-receipt="rcpt-ui"] input')!.click());await click('提交复核',form);await click('核对原操作结果',getByRole(document.body,'dialog',{name:'提交结算'}));
 form=getByRole(document.body,'dialog',{name:'提交结算'});expect(form.textContent).toContain('仍未连接');expect((getByRole(form,'button',{name:'核对原操作结果'}) as HTMLButtonElement).disabled).toBe(false);await click('核对原操作结果',form);
 store.value.state.fulfillment.purchases.push({...po,id:'next-contract',code:'PO-NEXT'});route={...route,id:'next-contract'};render();await act(async()=>{store.value.pending=null;resolve({requestId:'lost',revision:2,result:{id:'old-settlement'}});});expect(go).not.toHaveBeenCalledWith('payment-vouchers','old-settlement',expect.anything(),expect.anything());expect((getByLabelText(document.body,'结算合同') as HTMLSelectElement).value).toBe('next-contract');
});
it('locks the bill form while registration is in flight',async()=>{
  let finish!:()=>void;const original=store.value.run;store.value.run=vi.fn(()=>new Promise<any>(resolve=>{finish=()=>resolve(undefined);}));
  render();await click(/待登记来源/);await click('登记票据',getByRole(host,'table',{name:'待登记来源合同'}));
  const dialog=getByRole(document.body,'dialog',{name:'登记供应商票据'});
  input('供应商发票号','VAT-LOCK-01');input('税额','1');input('到期日',day);
  await click('登记应付',dialog);
  expect((getByLabelText(dialog,'供应商发票号') as HTMLInputElement).matches(':disabled')).toBe(true);
  await act(async()=>finish());store.value.run=original;
});
