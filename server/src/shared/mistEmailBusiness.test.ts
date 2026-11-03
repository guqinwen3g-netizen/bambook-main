import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';
import { emailBusinessOwner, emailLinkTarget } from './mistEmail';

function fixture() {
  let id = 0; const ctx = { id: () => `mb-${++id}`, now: '2026-10-14T02:00:00Z', actorId: 'sales', actorName: '顾言' } as MistContext;
  let state = createMistState(ctx, 'demo');
  const run = (command: MistCommand, c: MistContext = ctx) => { const r = applyMistCommand(state, command, c); state = r.state; return r.result; };
  return { ctx, run, get state() { return state; } };
}
describe('mail tied to business records', () => {
  it('links suppliers, purchases, quotations and RFQs and resolves their owner', () => {
    const f = fixture(), m = f.state.email.messages[0], sup = f.state.market.suppliers[0];
    f.run({ type: 'email.link', payload: { id: m.id, link: { kind: 'supplier', id: sup.id } } });
    expect(f.state.email.messages[0].links).toContainEqual({ kind: 'supplier', id: sup.id });
    expect(emailLinkTarget(f.state, { kind: 'supplier', id: sup.id })).toMatchObject({ view: 'suppliers', label: sup.name });
    const q = f.state.market.quotations[0];
    if (q) { expect(emailLinkTarget(f.state, { kind: 'quotation', id: q.id })?.view).toBe('quotations'); expect(emailBusinessOwner(f.state, { kind: 'quotation', id: q.id })).toBe(f.state.customers.find(c => c.id === q.customerId)?.ownerId); }
    const po = f.state.fulfillment.purchases[0];
    if (po) expect(emailLinkTarget(f.state, { kind: 'purchase', id: po.id })?.view).toBe('procurement');
  });
  it('assigns follow-ups to the chosen member and records them in the linked customer history', () => {
    const f = fixture(), m = f.state.email.messages.find(x => x.folder === 'inbox')!, customer = f.state.customers[0];
    f.run({ type: 'email.link', payload: { id: m.id, link: { kind: 'customer', id: customer.id } } });
    const other = (f.state.members || []).find(x => x.userId !== 'sales');
    const taskId = f.run({ type: 'email.followUp', payload: { id: m.id, ...(other ? { ownerId: other.userId } : {}), due: '2026-10-20', note: '回复交期' } }).id!;
    expect(f.state.tasks.find(t => t.id === taskId)!.assigneeIds).toEqual([other?.userId || 'sales']);
    expect(f.state.crm.followUps[0]).toMatchObject({ customerId: customer.id, method: 'email', nextDate: '2026-10-20', nextTaskId: taskId });
    expect(() => f.run({ type: 'email.followUp', payload: { id: m.id, ownerId: 'nobody', due: '2026-10-20', note: '' } })).toThrow('在职成员');
  });
  it('applies bulk actions and only purges messages already in 已删除', () => {
    const f = fixture(), ids = f.state.email.messages.filter(x => x.folder === 'inbox').slice(0, 2).map(x => x.id);
    expect(f.run({ type: 'email.bulk', payload: { ids, action: 'read' } }).applied).toBeGreaterThanOrEqual(0);
    expect(f.state.email.messages.filter(x => ids.includes(x.id)).every(x => x.read)).toBe(true);
    expect(() => f.run({ type: 'email.purge', payload: { ids } })).toThrow('已删除');
    f.run({ type: 'email.bulk', payload: { ids, action: 'trash' } });
    f.run({ type: 'email.purge', payload: { ids } });
    expect(f.state.email.messages.some(x => ids.includes(x.id))).toBe(false);
  });
  it('removes an account only after it is disconnected, keeping its history and blocking new drafts', () => {
    const f = fixture(), account = f.state.email.accounts[0];
    f.run({ type: 'email.account.remove', payload: { id: account.id, reason: '员工离职' } });
    expect(f.state.email.accounts[0].removed).toMatchObject({ reason: '员工离职' });
    expect(() => f.run({ type: 'email.draft.save', payload: { input: { accountId: account.id, from: account.address, to: 'a@b.com', cc: '', bcc: '', subject: 's', body: '', template: '', links: [], fileIds: [] } } })).toThrow('已移除');
  });
});
describe('company mail templates', () => {
  it('saves templates for admins and fills placeholders from linked records', async () => {
    const { fillEmailTemplate } = await import('./mistEmail');
    const { mistCommandPermission } = await import('./mistWorkspace');
    const f = fixture(), order = f.state.orders.find(o => f.state.customers.some(c => c.id === o.customerId))!;
    expect(mistCommandPermission({ type: 'email.template.save', payload: { name: 'x', subject: '', body: 'y' } } as MistCommand)).toBe('emails:admin');
    f.run({ type: 'email.template.save', payload: { name: '交期确认', subject: '交期确认 {订单号}', body: '{客户} 您好，{订单号} 交期 {交期}，{未知}' } });
    expect(() => f.run({ type: 'email.template.save', payload: { name: '交期确认', subject: '', body: 'x' } })).toThrow('同名');
    const t = f.state.email.templates![0];
    expect(fillEmailTemplate(f.state, t.body, [{ kind: 'order', id: order.id }])).toBe(`${f.state.customers.find(c => c.id === order.customerId)!.name} 您好，${order.code} 交期 ${order.due}，{未知}`);
  });
});
