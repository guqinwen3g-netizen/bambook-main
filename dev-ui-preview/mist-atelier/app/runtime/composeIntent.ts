/**
 * Hand-off from a business page to the smart mailbox: the page stores what the mail should carry (recipients, subject,
 * body, attached business files, record links) and opens the mailbox, which starts a draft from it once. Nothing is sent
 * until the user sends from the mailbox; the intent lives only in this tab's memory.
 */
import type { EmailLink } from '../../../../server/src/shared/mistEmail';
import type { MistCommand } from '../../../../server/src/shared/mistWorkspace';
/** afterSent：邮件被服务器接受后由邮箱执行的业务登记（如报表订阅本期已发）；放弃或发送失败时不执行。 */
export type ComposeIntent = { to?: string; bcc?: string; subject: string; body?: string; fileIds?: string[]; links?: EmailLink[]; afterSent?: MistCommand };
let pending: ComposeIntent | null = null;
export function setComposeIntent(intent: ComposeIntent) { pending = { ...intent, fileIds: [...(intent.fileIds || [])], links: [...(intent.links || [])] }; }
export function takeComposeIntent(): ComposeIntent | null { const value = pending; pending = null; return value; }
