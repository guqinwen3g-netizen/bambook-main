import React from 'react';
import { TASK_ATTACHMENT_COUNT, type TaskAttachment, type TaskAttachmentRef } from '../../../../server/src/shared/mistTaskAttachments';

export type AssistantReply = {
  role: 'user' | 'assistant'; content: string;
  sources?: Array<{ id: string; label: string; view: string; entityId: string }>;
  revision?: number; truncated?: boolean; contextToken?: string;
};
export type AssistantAttachmentRef = TaskAttachmentRef & Pick<TaskAttachment, 'name' | 'size'> & { needsVerification?: true };
type TaskAnswerDraft = {taskId:string;questionId:string;text:string};
export const taskAnswerDraftKey=(taskId:string,questionId:string)=>JSON.stringify([taskId,questionId]);
export type TaskControlRequest = {action:'answer'|'cancel';version:number;key:string;requestId:string};
type ComposerDraft = {
  question: string;
  selected: Array<{ id: string; label: string }>;
  files: File[];
  attachmentRefs: AssistantAttachmentRef[];
};
type Conversation = ComposerDraft & {
  messages: AssistantReply[];
  inactiveDrafts: Map<string, ComposerDraft>;
  answerDrafts: Map<string,TaskAnswerDraft>;
};
const emptyDraft = (): ComposerDraft => ({ question: '', selected: [], files: [], attachmentRefs: [] });
const empty = (): Conversation => ({ ...emptyDraft(), messages: [], inactiveDrafts: new Map(),answerDrafts:new Map() });
/** fin50：对话按账号与公司（scope）存本标签页 sessionStorage，切页与刷新后保留；换账号或关标签即清空。 */
const KEY = (scope: string) => 'mist.assistant.conversation:' + scope;
const attachmentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function storedAttachmentRefs(value: unknown): AssistantAttachmentRef[] {
  if (!Array.isArray(value) || value.length > TASK_ATTACHMENT_COUNT) return [];
  const fileIds = new Set<string>();
  return value.flatMap(ref => {
    const { taskId, fileId } = ref ?? {};
    if (typeof taskId !== 'string' || !attachmentId.test(taskId) || typeof fileId !== 'string' || !attachmentId.test(fileId)
      || fileIds.has(fileId)) return [];
    fileIds.add(fileId);
    return [{ taskId, fileId, name: '', size: 0, needsVerification: true as const }];
  });
}
function load(scope: string): Conversation {
  try { const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY(scope)); if (!raw) return empty(); const v = JSON.parse(raw) as Conversation; return Array.isArray(v?.messages) ? { ...empty(), question: String(v.question || ''), selected: Array.isArray(v.selected) ? v.selected : [], attachmentRefs: storedAttachmentRefs(v.attachmentRefs), messages: v.messages.slice(-40) } : empty(); } catch { return empty(); }
}
function save(scope: string, { question, selected, messages, attachmentRefs }: Conversation) { try { if (typeof sessionStorage !== 'undefined' && scope) sessionStorage.setItem(KEY(scope), JSON.stringify({ question, selected, messages, attachmentRefs: attachmentRefs.map(({taskId,fileId})=>({taskId,fileId})) })); } catch { /* storage full or blocked: keep in memory only */ } }

function useConversationState(scope: string) {
  const [entry, setEntry] = React.useState(() => ({ scope, value: load(scope) }));
  const taskControlRequests=React.useMemo(()=>new Map<string,TaskControlRequest>(),[scope]);
  React.useEffect(() => { if (entry.scope === scope) save(scope, entry.value); }, [entry, scope]);
  const live = React.useRef(scope);
  live.current = scope;
  const fresh = React.useMemo(empty, [scope]);
  React.useLayoutEffect(() => {
    setEntry(previous => previous.scope === scope ? previous : { scope, value: load(scope) });
  }, [scope]);
  const update = React.useCallback(<K extends keyof Conversation>(key: K, action: React.SetStateAction<Conversation[K]>) => {
    if (live.current !== scope) return;
    setEntry(previous => {
      if (live.current !== scope) return previous;
      const value = previous.scope === scope ? previous.value : empty();
      const next = typeof action === 'function'
        ? (action as (old: Conversation[K]) => Conversation[K])(value[key]) : action;
      if (next === value[key]) return previous;
      return { scope, value: { ...value, [key]: key === 'messages' ? (next as AssistantReply[]).slice(-40) : next } };
    });
  }, [scope]);
  const setQuestion = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(value => update('question', value), [update]);
  const setSelected = React.useCallback<React.Dispatch<React.SetStateAction<Conversation['selected']>>>(value => update('selected', value), [update]);
  const setMessages = React.useCallback<React.Dispatch<React.SetStateAction<AssistantReply[]>>>(value => update('messages', value), [update]);
  const setFiles = React.useCallback<React.Dispatch<React.SetStateAction<File[]>>>(value => update('files', value), [update]);
  const setAttachmentRefs = React.useCallback<React.Dispatch<React.SetStateAction<AssistantAttachmentRef[]>>>(value => update('attachmentRefs', value), [update]);
  const setAnswerDraft = React.useCallback((taskId:string,questionId:string,text:string)=>update('answerDrafts',old=>{
    const key=taskAnswerDraftKey(taskId,questionId), next=new Map(old);
    if(text)next.set(key,{taskId,questionId,text});else next.delete(key);
    return next;
  }),[update]);
  const discardAnswerDrafts = React.useCallback((discard:(draft:TaskAnswerDraft)=>boolean)=>update('answerDrafts',old=>{
    const retained=[...old].filter(([,draft])=>!discard(draft));
    return retained.length===old.size?old:new Map(retained);
  }),[update]);
  const switchDraft = React.useCallback((from: string, to: string) => {
    if (from === to || live.current !== scope) return;
    setEntry(previous => {
      if (previous.scope !== scope || live.current !== scope) return previous;
      const { question, selected, files, attachmentRefs, inactiveDrafts } = previous.value;
      const drafts = new Map(inactiveDrafts);
      const incoming = drafts.get(to) ?? emptyDraft();
      drafts.delete(to);
      if (question || selected.length || files.length || attachmentRefs.length) drafts.set(from, { question, selected, files, attachmentRefs });
      return { scope, value: { ...previous.value, ...incoming, inactiveDrafts: drafts } };
    });
  }, [scope]);
  const clearDraft = React.useCallback((id: string, activeId: string) => {
    if (live.current !== scope) return;
    setEntry(previous => {
      if (previous.scope !== scope || live.current !== scope) return previous;
      if (id === activeId) return { scope, value: { ...previous.value, ...emptyDraft() } };
      if (!previous.value.inactiveDrafts.has(id)) return previous;
      const inactiveDrafts = new Map(previous.value.inactiveDrafts);
      inactiveDrafts.delete(id);
      return { scope, value: { ...previous.value, inactiveDrafts } };
    });
  }, [scope]);
  return { scope, ...(entry.scope === scope ? entry.value : fresh), setQuestion, setSelected, setMessages, setFiles, setAttachmentRefs, switchDraft, clearDraft,setAnswerDraft,discardAnswerDrafts,taskControlRequests };
}

const Context = React.createContext<ReturnType<typeof useConversationState> | null>(null);

/** The active draft is tab/account/company scoped. Local file bytes and drafts in inactive threads stay in memory. */
export function AssistantConversationProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  const value = useConversationState(scope);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssistantConversation(scope: string) {
  const shared = React.useContext(Context);
  // Standalone reference pages have no workspace provider and retain page-local behavior.
  const scoped = shared?.scope === scope ? shared : undefined;
  const local = useConversationState(scoped ? '' : scope);
  return scoped ?? local;
}
