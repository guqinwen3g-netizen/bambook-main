// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveMailOAuthDraft, takeMailOAuthDraft, type MailOAuthDraft } from './mailOAuthDraft';

const scope = { actorId: 'user-1', workspaceId: 'company-1' };
const draft = (): MailOAuthDraft => ({ id: 'draft-1', forwardOfId: 'message-9', afterSent: { type: 'market.quotation.status', payload: { id: 'q1', status: 'Sent', evidence: 'mail' } } as any,
  input: { accountId: '', from: '', to: 'buyer@example.test', cc: '', bcc: '', subject: 'Quotation', body: '正文', template: '', fileIds: ['file-1'], links: [{ kind: 'quotation', id: 'q1' }] } });
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T09:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('授权跳转期间保留未发邮件', () => {
  it('restores the body, attachments, business links and follow-up once for the same person and company', () => {
    saveMailOAuthDraft(scope, draft());
    expect(sessionStorage.getItem('bambook:mail-oauth-draft')).not.toMatch(/token|password|code/i);
    expect(takeMailOAuthDraft(scope)).toEqual(draft());
    expect(takeMailOAuthDraft(scope)).toBeNull();
  });
  it.each([[{ actorId: 'user-2', workspaceId: 'company-1' }], [{ actorId: 'user-1', workspaceId: 'company-2' }]])('never hands a kept message to another person or company %#', other => {
    saveMailOAuthDraft(scope, draft());
    expect(takeMailOAuthDraft(other)).toBeNull();
    expect(takeMailOAuthDraft(scope)).toBeNull();
  });
  it('drops a kept message after fifteen minutes or with a clock that moved backwards', () => {
    saveMailOAuthDraft(scope, draft()); vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(takeMailOAuthDraft(scope)).toBeNull();
    saveMailOAuthDraft(scope, draft()); vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
    expect(takeMailOAuthDraft(scope)).toBeNull();
  });
  it('ignores malformed or foreign stored content and clears it', () => {
    for (const raw of ['not json', JSON.stringify({ version: 2, ...scope, at: Date.now(), draft: draft() }), JSON.stringify({ version: 1, ...scope, at: Date.now(), draft: { input: { ...draft().input, links: [{ kind: 'script', id: 'x' }] } } }),
      JSON.stringify({ version: 1, ...scope, at: Date.now(), draft: { input: { ...draft().input, fileIds: [7] } } }), JSON.stringify({ version: 1, ...scope, at: Date.now(), draft: { input: { to: 'a@b.c' } } })]) {
      sessionStorage.setItem('bambook:mail-oauth-draft', raw);
      expect(takeMailOAuthDraft(scope)).toBeNull(); expect(sessionStorage.getItem('bambook:mail-oauth-draft')).toBeNull();
    }
  });
  it('clears with no open message, refuses before the mailbox has loaded and refuses an oversized message', () => {
    saveMailOAuthDraft(scope, draft()); saveMailOAuthDraft(scope, null);
    expect(takeMailOAuthDraft(scope)).toBeNull();
    expect(() => saveMailOAuthDraft({ actorId: '', workspaceId: 'company-1' }, draft())).toThrow('请等待邮箱加载完成再连接');
    const big = draft(); big.input.body = 'x'.repeat(400_001);
    expect(() => saveMailOAuthDraft(scope, big)).toThrow('请先保存草稿后连接邮箱');
  });
});
