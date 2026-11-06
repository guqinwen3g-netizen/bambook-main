import React from 'react';

export type AssistantReply = {
  role: 'user' | 'assistant'; content: string;
  sources?: Array<{ id: string; label: string; view: string; entityId: string }>;
  revision?: number; truncated?: boolean;
};
type Conversation = {
  question: string;
  selected: Array<{ id: string; label: string }>;
  messages: AssistantReply[];
};
const empty = (): Conversation => ({ question: '', selected: [], messages: [] });
/** fin50：对话按账号与公司（scope）存本标签页 sessionStorage，切页与刷新后保留；换账号或关标签即清空。 */
const KEY = (scope: string) => 'mist.assistant.conversation:' + scope;
function load(scope: string): Conversation {
  try { const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY(scope)); if (!raw) return empty(); const v = JSON.parse(raw) as Conversation; return Array.isArray(v?.messages) ? { question: String(v.question || ''), selected: Array.isArray(v.selected) ? v.selected : [], messages: v.messages.slice(-40) } : empty(); } catch { return empty(); }
}
function save(scope: string, value: Conversation) { try { if (typeof sessionStorage !== 'undefined' && scope) sessionStorage.setItem(KEY(scope), JSON.stringify(value)); } catch { /* storage full or blocked: keep in memory only */ } }

function useConversationState(scope: string) {
  const [entry, setEntry] = React.useState(() => ({ scope, value: load(scope) }));
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
      return { scope, value: { ...value, [key]: key === 'messages' ? (next as AssistantReply[]).slice(-40) : next } };
    });
  }, [scope]);
  const setQuestion = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(value => update('question', value), [update]);
  const setSelected = React.useCallback<React.Dispatch<React.SetStateAction<Conversation['selected']>>>(value => update('selected', value), [update]);
  const setMessages = React.useCallback<React.Dispatch<React.SetStateAction<AssistantReply[]>>>(value => update('messages', value), [update]);
  return { scope, ...(entry.scope === scope ? entry.value : fresh), setQuestion, setSelected, setMessages };
}

const Context = React.createContext<ReturnType<typeof useConversationState> | null>(null);

/** Session/company memory only. It survives source navigation, not logout, company change or reload. */
export function AssistantConversationProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  const value = useConversationState(scope);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssistantConversation(scope: string) {
  const shared = React.useContext(Context);
  // Standalone reference pages have no workspace provider and retain page-local behavior.
  const local = useConversationState(scope);
  return shared?.scope === scope ? shared : local;
}
