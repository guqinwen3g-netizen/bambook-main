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

function useConversationState(scope: string) {
  const [entry, setEntry] = React.useState(() => ({ scope, value: empty() }));
  const live = React.useRef(scope);
  live.current = scope;
  const fresh = React.useMemo(empty, [scope]);
  React.useLayoutEffect(() => {
    setEntry(previous => previous.scope === scope ? previous : { scope, value: empty() });
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
