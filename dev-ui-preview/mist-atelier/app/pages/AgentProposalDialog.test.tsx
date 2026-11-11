// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { MistRoot } from '../../../../components/mist';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { AgentProposalDialog } from './AgentProposalDialog';

it('shows precise proposed mail values and evidence, and disables confirmation when the analyzed source is stale', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo'), mail = state.email.messages[0];
  mail.analysis = { id: 'a', at: '', actor: '', sourceHash: '', category: '订单往来', summary: '', fields: [{ id: 'qty', field: '数量', value: '120 pcs', source: 'body', quote: 'Quantity: 120 pcs.' }], warnings: [], truncated: false, attachmentCount: 0 };
  const proposal = { id: 'p', ownerId: 'u', owner: '顾言', summary: ['复核邮件资料'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z', command: { type: 'email.extraction.review', payload: { id: mail.id, analysisId: 'a', category: '订单往来', fields: [{ id: 'qty', value: '120 pcs（待确认）' }], note: '保留请求语气' } } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), run = vi.fn().mockResolvedValue({});
  const render = () => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={run} onClose={() => {}} onDone={() => {}} /></MistRoot>);
  try {
    act(render); expect(document.body.textContent).toContain('120 pcs（待确认）'); expect(document.body.textContent).toContain('Quantity: 120 pcs.'); expect(document.body.textContent).toContain('保留请求语气');
    mail.analysis.id = 'changed'; act(render);
    expect(document.body.textContent).toContain('邮件或整理版本已变化');
    const confirm = [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
    expect(confirm.disabled).toBe(true); await act(async () => confirm.click()); expect(run).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); host.remove(); }
});

it('shows the risk tier; medium lists fields to change, high requires the login password and sends it only with the confirmation', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const base = { id: 'p', ownerId: 'u', owner: '林舒', summary: ['Agent 提议'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), run = vi.fn().mockResolvedValue({});
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} run={run} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  const confirmButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
  try {
    show({ ...base, command: { type: 'customer.update', payload: { id: 'c1', patch: { name: '新客户名', terms: 'T/T 30%' } } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('medium');
    const changes = document.querySelector('[data-agent-proposal-changes]')?.textContent || '';
    expect(changes).toContain('名称 · 新客户名'); expect(changes).toContain('条款 · T/T 30%'); expect(changes).not.toContain('patch');
    expect(document.querySelector('input[type="password"]')).toBeNull(); expect(confirmButton().disabled).toBe(false);

    show({ ...base, id: 'p2', command: { type: 'payable.payment.register', payload: { requestId: 'r', amount: 100 } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
    // 权限码是实现细节，界面只显示风险等级（服务端仍校验 ai:write:high）。
    expect(document.body.textContent).not.toContain('ai:write');
    // 高风险同样列出将要执行的内容，不能只给摘要和密码框。
    expect(document.querySelector('[data-agent-proposal-changes]')?.textContent).toContain('金额 · 100');
    const input = document.querySelector('input[type="password"]') as HTMLInputElement; expect(input).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Secret-1'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(confirmButton().disabled).toBe(false);
    await act(async () => confirmButton().click());
    expect(run).toHaveBeenCalledWith({ type: 'agent.proposal.confirm', payload: { id: 'p2' } }, { reauth: { password: 'Secret-1' } });

    // 目录外的普通写入按规则为中风险（用户 2026-11-02 定案：只有付款、核销、审批类为高风险），不要求密码。
    run.mockClear(); show({ ...base, id: 'p3', command: { type: 'unregistered.command', payload: {} } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('medium');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

it('high-risk bank account changes show the full new account beside the current one before the password is entered', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo');
  state.bankAccounts = [{ id: 'ba1', code: 'BA-001', name: '美元户', bankName: '中国银行上海分行', accountNo: '4567000011112222', currency: 'USD', openingDate: '2026-10-01', openingBalance: 0, createdAt: '', actor: '' }];
  const base = { ownerId: 'u', owner: '林舒', summary: ['修改银行账户 BA-001'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  try {
    show({ ...base, id: 'b1', command: { type: 'finance.account.save', payload: { id: 'ba1', name: '美元户', bankName: '招商银行苏州分行', accountNo: '6214 8899 0000 1234', currency: 'usd', openingDate: '2026-10-01', openingBalance: 0 } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
    const account = document.querySelector('[data-agent-proposal-account]')!;
    expect(account.textContent).toContain('6214889900001234'); expect(account.textContent).toContain('4567000011112222');
    expect(account.textContent).toContain('招商银行苏州分行'); expect(account.textContent).toContain('中国银行上海分行');
    expect(account.querySelectorAll('[data-changed]').length).toBe(2);
    expect(document.querySelector('[data-agent-proposal-changes]')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeTruthy();

    state.market.suppliers[0].bankAccounts = [{ id: 'sb1', currency: 'CNY', accountName: '江南成衣', bankName: '工商银行', accountNo: '1111222233334444', verification: '电话核实', addedAt: '', addedBy: '', state: 'active' }];
    show({ ...base, id: 'b2', command: { type: 'market.supplier.bank.save', payload: { supplierId: state.market.suppliers[0].id, currency: 'CNY', accountName: '江南成衣', bankName: '农业银行', accountNo: '9999888877776666', verification: '按合同电话回拨核实' } } });
    const supplier = document.querySelector('[data-agent-proposal-account]')!;
    expect(supplier.textContent).toContain(state.market.suppliers[0].name); expect(supplier.textContent).toContain('9999888877776666');
    expect(supplier.textContent).toContain('1111222233334444'); expect(supplier.textContent).toContain('按合同电话回拨核实');
  } finally { act(() => root.unmount()); host.remove(); }
});

it('high-risk proposals list every array item untruncated, and block confirmation when the content exceeds what the dialog can show', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo');
  const base = { ownerId: 'u', owner: '林舒', summary: ['分配付款'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  const confirmButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
  const fill = () => { const input = document.querySelector('input[type="password"]') as HTMLInputElement; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Secret-1'); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
  try {
    const allocations = Array.from({ length: 5 }, (_, i) => ({ billId: 'AP-' + (i + 1), amount: 1000 + i }));
    const longNote = '核对依据'.repeat(80);
    show({ ...base, id: 'a1', command: { type: 'payable.payment.allocate', payload: { paymentId: 'PAY-1', allocations, note: longNote } } });
    const text = document.querySelector('[data-agent-proposal-changes]')!.textContent!;
    for (let i = 1; i <= 5; i++) expect(text).toContain('分配 · 第' + i + '项 · 应付单 · AP-' + i);
    expect(text).toContain(longNote); expect(text).not.toContain('…');
    fill(); expect(confirmButton().disabled).toBe(false);

    show({ ...base, id: 'a2', command: { type: 'payable.payment.allocate', payload: { paymentId: 'PAY-2', allocations: Array.from({ length: 150 }, (_, i) => ({ billId: 'AP-' + i, amount: i })) } } });
    expect(document.body.textContent).toContain('内容过多，无法在此完整核对');
    fill(); expect(confirmButton().disabled).toBe(true);

    state.settings.companyProfile = { ...(state.settings.companyProfile as any), bankName: '中国银行苏州分行', bankAccount: '1111222233334444', swift: 'BKCHCNBJ' };
    show({ ...base, id: 'a3', command: { type: 'settings.update', payload: { companyProfile: { bankName: '招商银行苏州分行', bankAccount: '9999 8888 7777 6666', swift: 'CMBCCNBS' } } } });
    const account = document.querySelector('[data-agent-proposal-account]')!.textContent!;
    expect(account).toContain('9999888877776666'); expect(account).toContain('1111222233334444'); expect(account).toContain('CMBCCNBS'); expect(account).toContain('BKCHCNBJ');
    expect(document.querySelector('[data-agent-proposal-changes]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

describe('signature on Agent-drafted approvals', () => {
 it('requires the confirming person to sign a contract or money approval before it can run', async () => {
  const { commandRequiresSignature } = await import('../runtime/signatureRules');
  expect(commandRequiresSignature({ type: 'fulfillment.procurement.decide', payload: { id: 'p', decision: 'approved', note: 'ok' } })).toBe(true);
  expect(commandRequiresSignature({ type: 'fulfillment.procurement.decide', payload: { id: 'p', decision: 'rejected', note: 'no' } })).toBe(false);
  expect(commandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { kind: 'badDebt' } })).toBe(true);
  expect(commandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { kind: 'rounding' } })).toBe(false);
  expect(commandRequiresSignature({ type: 'payable.settlement.confirm', payload: {} })).toBe(true);
  expect(commandRequiresSignature({ type: 'market.quotation.decide', payload: { decision: 'approved' } })).toBe(false);
 });
});

it('shows development draft business fields and source filenames without internal wrapper paths',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-11T00:00:00Z',actorName:'Test'},'empty');state.drafts=[{id:'draft-private',values:{name:'羊毛大衣'},fileIds:['file-private']} as any];state.files=[{id:'file-private',name:'RFQ.docx'} as any];
 const p={id:'p',ownerId:'u',owner:'顾言',summary:['保存开发草稿'],state:'pending',createdAt:'2026-11-11',command:{type:'development.saveDraft',payload:{draftId:'draft-private',values:{name:'羊毛大衣',style:'NW-31',fabric:'80% wool',kind:'new',target:'',factories:[],sampleQuantity:2},fileIds:['file-private']}}};
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{
  const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={p as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));
  const confirm=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='确认执行')!;
  render();const text=host.textContent||'';expect(text).toContain('客户款号 · NW-31');expect(text).toContain('面料 · 80% wool');expect(text).toContain('RFQ.docx');expect(text).not.toContain('draft-private');expect(text).not.toContain('file-private');expect(text).not.toContain('values');expect(confirm().disabled).toBe(false);
  const drafts=state.drafts;state.drafts=[];render();expect(host.textContent).toContain('草稿或附件已不可见，请重新核对');expect(confirm().disabled).toBe(true);
  state.drafts=drafts;state.files=[];render();expect(host.textContent).toContain('附件已不可见');expect(confirm().disabled).toBe(true);
 }
 finally{act(()=>root.unmount());host.remove();}
});
