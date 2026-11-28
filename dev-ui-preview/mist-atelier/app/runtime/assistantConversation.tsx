import React from 'react';
import { readTaskControls } from './xiaozhuControlRequests';
import { TASK_ATTACHMENT_COUNT, type TaskAttachment, type TaskAttachmentRef } from '../../../../server/src/shared/mistTaskAttachments';

export type AssistantReply = {
  role: 'user' | 'assistant'; content: string;
  sources?: Array<{ id: string; label: string; view: string; entityId: string }>;
  revision?: number; truncated?: boolean; contextToken?: string;
};
type RetryAttachmentRef = TaskAttachmentRef & { preserveScope?: true };
export type AssistantAttachmentRef = RetryAttachmentRef & Pick<TaskAttachment, 'name' | 'size'> & { needsVerification?: true };

export function taskAttachmentRefPayload({taskId, fileId, preserveScope}: RetryAttachmentRef): RetryAttachmentRef {
  return {taskId, fileId, ...(preserveScope === true ? {preserveScope: true} : {})};
}
type TaskAnswerDraft = {taskId:string;questionId:string;text:string;files:readonly File[]};
const emptyAnswerFiles:readonly File[]=[];
export const taskAnswerDraftKey=(taskId:string,questionId:string)=>JSON.stringify([taskId,questionId]);
type ComposerDraft = {
  question: string;
  selected: Array<{ id: string; label: string }>;
  files: File[];
  attachmentRefs: AssistantAttachmentRef[];
};
type Conversation = ComposerDraft & {
  messages: AssistantReply[];
  activeDraftId?: string;
  inactiveDrafts: Map<string, ComposerDraft>;
  answerDrafts: Map<string,TaskAnswerDraft>;
  workLogExpanded: Map<string,boolean>;
  readOnlyQuestion: string;
  readOnlySelected: ComposerDraft['selected'];
};
const emptyDraft = (): ComposerDraft => ({ question: '', selected: [], files: [], attachmentRefs: [] });
const empty = (): Conversation => ({ ...emptyDraft(), messages: [], inactiveDrafts: new Map(),answerDrafts:new Map(), workLogExpanded:new Map(), readOnlyQuestion:'', readOnlySelected:[] });
/** fin50：对话按账号与公司（scope）存本标签页 sessionStorage，切页与刷新后保留；换账号或关标签即清空。 */
const KEY = (scope: string) => 'mist.assistant.conversation:' + scope;
const attachmentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function storedAttachmentRefs(value: unknown): AssistantAttachmentRef[] {
  if (!Array.isArray(value) || value.length > TASK_ATTACHMENT_COUNT) return [];
  const fileIds = new Set<string>();
  return value.flatMap(ref => {
    const { taskId, fileId, preserveScope } = ref ?? {};
    if (typeof taskId !== 'string' || !attachmentId.test(taskId) || typeof fileId !== 'string' || !attachmentId.test(fileId)
      || fileIds.has(fileId)) return [];
    fileIds.add(fileId);
    return [{ ...taskAttachmentRefPayload({taskId,fileId,preserveScope}), name: '', size: 0, needsVerification: true as const }];
  });
}
const validConversationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
const hasDraft = ({question, selected, files, attachmentRefs}: ComposerDraft) =>
  !!(question || selected.length || files.length || attachmentRefs.length);

function selectedConversation(scope: string) {
  // Match the composer selection, which uses the remembered ID when this tab has none.
  try {
    const key = 'mist.xiaozhu.conversation:' + scope;
    const id = sessionStorage.getItem(key) ?? localStorage.getItem(key);
    return validConversationId(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function readDraft(value: unknown): ComposerDraft {
  if (!value || typeof value !== 'object') return emptyDraft();
  const {question, selected, attachmentRefs} = value as Partial<Record<keyof ComposerDraft, unknown>>;
  return {
    question: typeof question === 'string' ? question : '',
    selected: Array.isArray(selected) ? selected.filter(source =>
      typeof source?.id === 'string' && typeof source.label === 'string') : [],
    files: [],
    attachmentRefs: storedAttachmentRefs(attachmentRefs),
  };
}

function storedDraft({question, selected, attachmentRefs}: ComposerDraft) {
  return {question, selected, attachmentRefs: attachmentRefs.map(taskAttachmentRefPayload)};
}

function load(scope: string): Conversation {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY(scope));
    if (!raw) return empty();
    const value = JSON.parse(raw);
    if (!Array.isArray(value?.messages)) return empty();
    const inactiveDrafts = new Map<string, ComposerDraft>();
    for (const entry of Array.isArray(value.inactiveDrafts) ? value.inactiveDrafts : []) {
      if (!Array.isArray(entry) || !validConversationId(entry[0])) continue;
      const draft = readDraft(entry[1]);
      if (hasDraft(draft)) inactiveDrafts.set(entry[0], draft);
    }
    const activeDraftId = selectedConversation(scope);
    let active = readDraft(value);
    if (validConversationId(value.activeDraftId) && value.activeDraftId !== activeDraftId) {
      // A reload can observe a selection update before the corresponding draft save.
      if (hasDraft(active)) inactiveDrafts.set(value.activeDraftId, active);
      active = (activeDraftId ? inactiveDrafts.get(activeDraftId) : undefined) ?? emptyDraft();
    }
    if (activeDraftId) inactiveDrafts.delete(activeDraftId);
    return { ...empty(), ...active, activeDraftId, inactiveDrafts, messages: value.messages.slice(-40) };
  } catch {
    return empty();
  }
}

function save(scope: string, value: Conversation) {
  try {
    if (typeof sessionStorage === 'undefined' || !scope) return;
    const {messages, inactiveDrafts} = value;
    const inactive = [...inactiveDrafts].flatMap(([id, draft]) => {
      const safe = storedDraft(draft);
      return validConversationId(id) && (safe.question || safe.selected.length || safe.attachmentRefs.length)
        ? [[id, safe]] : [];
    });
    sessionStorage.setItem(KEY(scope), JSON.stringify({
      ...storedDraft(value), messages, activeDraftId: value.activeDraftId ?? selectedConversation(scope), inactiveDrafts: inactive,
    }));
  } catch { /* storage full or blocked: keep in memory only */ }
}

function useConversationState(scope: string, controlStorageScope?: string) {
  const [entry, setEntry] = React.useState(() => ({ scope, value: load(scope) }));
  const taskControlRequests=React.useMemo(()=>readTaskControls(controlStorageScope??''),[scope,controlStorageScope]);
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
  const setReadOnlyQuestion = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(value => update('readOnlyQuestion', value), [update]);
  const setReadOnlySelected = React.useCallback<React.Dispatch<React.SetStateAction<Conversation['selected']>>>(value => update('readOnlySelected', value), [update]);
  const setMessages = React.useCallback<React.Dispatch<React.SetStateAction<AssistantReply[]>>>(value => update('messages', value), [update]);
  const setFiles = React.useCallback<React.Dispatch<React.SetStateAction<File[]>>>(value => update('files', value), [update]);
  const setAttachmentRefs = React.useCallback<React.Dispatch<React.SetStateAction<AssistantAttachmentRef[]>>>(value => update('attachmentRefs', value), [update]);
  const updateAnswerDraft = React.useCallback((taskId:string,questionId:string,patch:Partial<Pick<TaskAnswerDraft,'text'|'files'>>)=>update('answerDrafts',old=>{
    const key=taskAnswerDraftKey(taskId,questionId), next=new Map(old);
    const draft={taskId,questionId,text:'',files:emptyAnswerFiles,...old.get(key),...patch};
    if(draft.text||draft.files.length)next.set(key,draft);else next.delete(key);
    return next;
  }),[update]);
  const setAnswerDraft=React.useCallback((taskId:string,questionId:string,text:string)=>updateAnswerDraft(taskId,questionId,{text}),[updateAnswerDraft]);
  const setAnswerFiles=React.useCallback((taskId:string,questionId:string,files:readonly File[])=>updateAnswerDraft(taskId,questionId,{files}),[updateAnswerDraft]);
  const setWorkLogExpanded = React.useCallback((taskId: string, expanded: boolean) =>
    update('workLogExpanded', previous => previous.get(taskId) === expanded
      ? previous : new Map(previous).set(taskId, expanded)), [update]);
  const discardAnswerDrafts = React.useCallback((discard:(draft:TaskAnswerDraft)=>boolean)=>update('answerDrafts',old=>{
    const retained=[...old].filter(([,draft])=>!discard(draft));
    return retained.length===old.size?old:new Map(retained);
  }),[update]);
  const switchDraft = React.useCallback((from: string, to: string) => {
    if (from === to || live.current !== scope) return;
    setEntry(previous => {
      if (previous.scope !== scope || live.current !== scope) return previous;
      const { question, selected, files, attachmentRefs, inactiveDrafts, activeDraftId } = previous.value;
      const outgoing = { question, selected, files, attachmentRefs };
      const drafts = new Map(inactiveDrafts);
      const incoming = drafts.get(to) ?? emptyDraft();
      drafts.delete(to);
      if (hasDraft(outgoing)) drafts.set(activeDraftId ?? from, outgoing);
      return { scope, value: { ...previous.value, ...incoming, activeDraftId: to, inactiveDrafts: drafts } };
    });
  }, [scope]);
  const clearDraft = React.useCallback((id: string, activeId: string) => {
    if (live.current !== scope) return;
    setEntry(previous => {
      if (previous.scope !== scope || live.current !== scope) return previous;
      if (id === (previous.value.activeDraftId ?? activeId)) return { scope, value: { ...previous.value, ...emptyDraft() } };
      if (!previous.value.inactiveDrafts.has(id)) return previous;
      const inactiveDrafts = new Map(previous.value.inactiveDrafts);
      inactiveDrafts.delete(id);
      return { scope, value: { ...previous.value, inactiveDrafts } };
    });
  }, [scope]);
  const value=entry.scope===scope?entry.value:fresh;
  const readAnswerFiles=React.useCallback((taskId:string,questionId:string)=>
    value.answerDrafts.get(taskAnswerDraftKey(taskId,questionId))?.files??emptyAnswerFiles,[value.answerDrafts]);
  return { scope, ...value, setQuestion, setSelected, setMessages, setFiles, setAttachmentRefs, switchDraft, clearDraft,setAnswerDraft,readAnswerFiles,setAnswerFiles,discardAnswerDrafts,taskControlRequests,controlStorageScope,setWorkLogExpanded,setReadOnlyQuestion,setReadOnlySelected };
}

const Context = React.createContext<ReturnType<typeof useConversationState> | null>(null);

/** Drafts are tab/account/company scoped. Local file bytes stay in memory. */
export function AssistantConversationProvider({ scope, controlStorageScope, children }: { scope: string; controlStorageScope?: string; children: React.ReactNode }) {
  const value = useConversationState(scope,controlStorageScope);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssistantConversation(scope: string) {
  const shared = React.useContext(Context);
  // Standalone reference pages have no workspace provider and retain page-local behavior.
  const scoped = shared?.scope === scope ? shared : undefined;
  const local = useConversationState(scoped ? '' : scope);
  return scoped ?? local;
}
