import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';
import { fillEmailTemplate } from './mistEmail';

function fixture() {
  let n = 0;
  const context: MistContext = { id: () => `mail-safety-${++n}`, now: '2026-11-01T00:00:00Z', actorId: 'demo-sales', actorName: '业务员' };
  let state = createMistState(context, 'demo');
  const run = (command: MistCommand) => { const result = applyMistCommand(state, command, context); state = result.state; return result.result; };
  const account = state.email.accounts[0];
  account.ownerId = context.actorId; account.memberIds = [];
  const input = { accountId: account.id, from: account.address, to: 'buyer@example.com', cc: '', bcc: '', subject: '交期', body: '', template: '', links: [], fileIds: [] };
  return { context, run, input, get state() { return state; } };
}

describe('local mail command safety', () => {
  it.each(['read', 'trash', 'link'] as const)('rolls back the entire bulk %s when a later message is private', action => {
    const f = fixture(), first = f.state.email.messages[0], second = f.state.email.messages[1];
    first.read = false;
    f.state.email.accounts.push({ ...f.state.email.accounts[0], id: 'private-account', ownerId: 'other', memberIds: [] });
    second.accountId = 'private-account';
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'email.bulk', payload: { ids: [first.id, second.id], action, link: { kind: 'supplier', id: f.state.market.suppliers[0].id } } })).toThrow('邮件不存在');
    expect(f.state).toEqual(before);
  });

  it('rejects private messages for flag and purge without changing either mailbox', () => {
    const f = fixture(), message = f.state.email.messages[0];
    f.state.email.accounts[0].ownerId = 'other'; message.folder = 'trash';
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'email.flag', payload: { id: message.id, flag: 'read', value: true } })).toThrow('邮件不存在');
    expect(() => f.run({ type: 'email.purge', payload: { ids: [message.id] } })).toThrow('邮件不存在');
    expect(f.state).toEqual(before);
  });

  it('keeps business attachments and attachments used by another mailbox when purging', () => {
    const f = fixture(), message = f.state.email.messages[0], other = f.state.email.messages[1];
    const ids = ['business-proof', 'other-mail-proof', 'orphan-proof'];
    for (const id of ids) f.state.files.push({ id, name: `${id}.txt`, mimeType: 'text/plain', size: 1, storageKey: `fixture/${id}`, createdAt: f.context.now });
    message.attachments = ids.map(fileId => ({ id: fileId, fileId, name: `${fileId}.txt`, size: 1, contentType: 'text/plain' }));
    message.folder = 'trash';
    f.state.orders[0].fileIds = ['business-proof'];
    other.attachments = [structuredClone(message.attachments[1])];
    f.state.email.accounts.push({ ...f.state.email.accounts[0], id: 'other-account', ownerId: 'other', memberIds: [] });
    other.accountId = 'other-account';
    const otherBefore = structuredClone(other), orderBefore = structuredClone(f.state.orders[0]);
    f.run({ type: 'email.purge', payload: { ids: [message.id] } });
    expect(f.state.email.messages.some(row => row.id === message.id)).toBe(false);
    expect(f.state.email.messages.find(row => row.id === other.id)).toEqual(otherBefore);
    expect(f.state.orders[0]).toEqual(orderBefore);
    expect(f.state.files.filter(file => ids.includes(file.id)).map(file => file.id).sort()).toEqual(['business-proof', 'other-mail-proof']);
  });

  it('retains submitted business evidence and rolls back mixed purge selections', () => {
    const f = fixture(), [first, second] = f.state.email.messages;
    first.folder = second.folder = 'trash';
    second.submissions.push({ at: f.context.now, actor: '业务员', link: second.links[0], taskId: 'review-task' });
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'email.purge', payload: { ids: [first.id, second.id] } })).toThrow('需保留记录');
    expect(f.state).toEqual(before);
  });

  it('allows removing a stale link but refuses handing off a deleted business target', () => {
    const f = fixture(), message = f.state.email.messages[0], link = { kind: 'order' as const, id: f.state.orders[0].id };
    message.links.push(link);
    f.state.orders = f.state.orders.filter(order => order.id !== link.id);
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'email.submitExtraction', payload: { id: message.id, link } })).toThrow('不在本公司');
    expect(f.state).toEqual(before);
    f.run({ type: 'email.unlink', payload: { id: message.id, link } });
    expect(f.state.email.messages[0].links).not.toContainEqual(link);
  });

  it('retains drafts and failed sending history after account removal but blocks new draft edits', () => {
    const f = fixture(), id = f.run({ type: 'email.draft.save', payload: { input: f.input } }).id!;
    const draft = structuredClone(f.state.email.drafts[0]);
    f.state.email.sends.push({ ...draft, id: 'failed-send', requestKey: 'failed-intent', messageId: '<failed@example.com>', status: 'failed', attempts: [], response: '', createdBy: '业务员', createdById: 'demo-sales' });
    const sends = structuredClone(f.state.email.sends);
    f.run({ type: 'email.account.remove', payload: { id: f.input.accountId, reason: '不再使用' } });
    expect(f.state.email.drafts[0]).toEqual(draft);
    expect(f.state.email.sends).toEqual(sends);
    expect(() => f.run({ type: 'email.draft.save', payload: { id, input: { ...f.input, body: 'new' } } })).toThrow('已移除');
  });

  it.each(['sending', 'unknown'] as const)('retains an account with an unresolved %s send', status => {
    const f = fixture();
    f.run({ type: 'email.draft.save', payload: { input: f.input } });
    f.state.email.sends.push({ ...f.state.email.drafts[0], id: 'unresolved-send', requestKey: 'unresolved-intent', messageId: '<unresolved@example.com>', status, attempts: [], response: '', createdBy: '业务员', createdById: 'demo-sales' });
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'email.account.remove', payload: { id: f.input.accountId, reason: '不再使用' } })).toThrow('结果待核对');
    expect(f.state).toEqual(before);
  });

  it('keeps unresolved template placeholders editable when linked values are missing', () => {
    const f = fixture();
    expect(fillEmailTemplate(f.state, '{客户}/{订单号}/{未知}', [])).toBe('{客户}/{订单号}/{未知}');
    f.run({ type: 'email.template.save', payload: { name: '待补充', subject: '{订单号}', body: '{未知}' } });
    expect(f.state.email.templates![0].body).toBe('{未知}');
  });
});
