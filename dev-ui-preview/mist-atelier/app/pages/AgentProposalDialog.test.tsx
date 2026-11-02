// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
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
    expect(changes).toContain('patch.name · 新客户名'); expect(changes).toContain('patch.terms · T/T 30%');
    expect(document.querySelector('input[type="password"]')).toBeNull(); expect(confirmButton().disabled).toBe(false);

    show({ ...base, id: 'p2', command: { type: 'payable.payment.register', payload: { requestId: 'r', amount: 100 } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
    expect(document.body.textContent).toContain('ai:write:high');
    const input = document.querySelector('input[type="password"]') as HTMLInputElement; expect(input).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Secret-1'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(confirmButton().disabled).toBe(false);
    await act(async () => confirmButton().click());
    expect(run).toHaveBeenCalledWith({ type: 'agent.proposal.confirm', payload: { id: 'p2' } }, { reauth: { password: 'Secret-1' } });

    run.mockClear(); show({ ...base, id: 'p3', command: { type: 'unregistered.command', payload: {} } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
  } finally { act(() => root.unmount()); host.remove(); }
});
