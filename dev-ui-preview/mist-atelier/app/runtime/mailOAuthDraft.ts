import type { EmailDraftInput } from '../../../../server/src/shared/mistEmail';
import type { MistCommand } from '../../../../server/src/shared/mistWorkspace';

export type MailOAuthDraft = { id?: string; input: EmailDraftInput; forwardOfId?: string; afterSent?: MistCommand };
type Scope = { actorId: string; workspaceId: string };
const KEY = 'bambook:mail-oauth-draft';
const TTL = 15 * 60_000;

/** Preserve the current unsent message across provider navigation. No password, authorization code or token is stored. */
export function saveMailOAuthDraft(scope: Scope, draft: MailOAuthDraft | null) {
  if (!scope.actorId || !scope.workspaceId) throw new Error('请等待邮箱加载完成再连接');
  try {
    if (!draft) { sessionStorage.removeItem(KEY); return; }
    const value = JSON.stringify({ version: 1, ...scope, draft, at: Date.now() });
    if (value.length > 400_000) throw new Error();
    sessionStorage.setItem(KEY, value);
  } catch { throw new Error('无法保留正在写的邮件，请先保存草稿后连接邮箱'); }
}
export function takeMailOAuthDraft(scope: Scope): MailOAuthDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); if (!raw) return null;
    const v = JSON.parse(raw), d = v.draft, input = d?.input;
    if (v.version !== 1 || v.actorId !== scope.actorId || v.workspaceId !== scope.workspaceId || typeof v.at !== 'number' || Date.now() - v.at > TTL || Date.now() < v.at || !input) return null;
    if (!['accountId', 'from', 'to', 'cc', 'bcc', 'subject', 'body', 'template'].every(key => typeof input[key] === 'string') ||
      !Array.isArray(input.fileIds) || input.fileIds.some((id: unknown) => typeof id !== 'string') || !Array.isArray(input.links) ||
      input.links.some((link: any) => !link || typeof link.id !== 'string' || !['customer', 'development', 'order', 'invoice', 'supplier', 'purchase', 'quotation', 'rfq'].includes(link.kind))) return null;
    return d as MailOAuthDraft;
  } catch { return null; }
}
