/**
 * Hand-off from a business page to the smart mailbox: the page stores what the mail should carry (recipients, subject,
 * body, attached business files, record links) and opens the mailbox, which starts a draft from it once. Nothing is sent
 * until the user sends from the mailbox; the intent lives only in this tab's memory.
 */
import type { EmailLink } from '../../../../server/src/shared/mistEmail';
export type ComposeIntent = { to?: string; bcc?: string; subject: string; body?: string; fileIds?: string[]; links?: EmailLink[] };
let pending: ComposeIntent | null = null;
export function setComposeIntent(intent: ComposeIntent) { pending = { ...intent, fileIds: [...(intent.fileIds || [])], links: [...(intent.links || [])] }; }
export function takeComposeIntent(): ComposeIntent | null { const value = pending; pending = null; return value; }
