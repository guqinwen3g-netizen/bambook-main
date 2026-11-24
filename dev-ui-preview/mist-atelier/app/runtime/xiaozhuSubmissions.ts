import type { AgentTaskIntentRef } from '../../../../server/src/shared/mistAgentTasks';

export type PendingSubmission = {
  requestId: string;
  instructions: string;
  locale: string;
  draftKey: string;
  conversationId?: string;
  sourceConversationId?: string;
  hasAttachments: boolean;
  recoveredFromStorage?: boolean;
};

export const submissionDraftKey = (text: string, refs: readonly AgentTaskIntentRef[]) => JSON.stringify([text.trim(), refs]);
export async function submissionFingerprint(conversationId: string|undefined, text: string, refs: readonly AgentTaskIntentRef[],
  attachmentRefs: readonly {taskId:string;fileId:string}[], files: readonly File[]) {
  const fileIdentity = await Promise.all(files.map(async file => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [file.name,file.type,file.size,Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')];
  }));
  return JSON.stringify([conversationId,text.trim(),refs,attachmentRefs,fileIdentity]);
}
const storageKey = (scope: string) => 'mist.xiaozhu.submissions:' + scope;

export function readPendingSubmissions(scope: string): Map<string, PendingSubmission> {
  const entries = new Map<string, PendingSubmission>();
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(scope)) ?? '[]');
    if (!Array.isArray(stored)) return entries;
    for (const [key, entry] of stored.filter(Array.isArray)) {
      if (typeof key !== 'string' || typeof entry?.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.requestId)
        || typeof entry.instructions !== 'string' || typeof entry.locale !== 'string' || typeof entry.draftKey !== 'string'
        || typeof entry.hasAttachments !== 'boolean' || (entry.conversationId !== undefined && typeof entry.conversationId !== 'string')
        || (entry.sourceConversationId !== undefined && typeof entry.sourceConversationId !== 'string')) continue;
      entries.set(key, { ...entry, recoveredFromStorage: true });
    }
  } catch { /* The active page still supports in-memory retries. */ }
  return entries;
}

export function savePendingSubmissions(scope: string, entries: ReadonlyMap<string, PendingSubmission>) {
  try {
    if (entries.size) sessionStorage.setItem(storageKey(scope), JSON.stringify([...entries]));
    else sessionStorage.removeItem(storageKey(scope));
  } catch { /* The active page still supports in-memory retries. */ }
}
