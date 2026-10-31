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
