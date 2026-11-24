/**
 * 小竹的 cowork（2026-11-07 定案）：对话里的每一条请求就是一项交给小竹的平台任务，
 * 小竹经平台 AI 与 MCP 业务工具办理，进度、追问和待确认事项回到同一条对话里；对话由服务端任务记录承载，换设备也在。
 * 需要确认的写入仍只留提议，等本人在「接着完成」确认。
 */
import React from 'react';
import type { AgentIdentityView } from '../../../../server/src/shared/mistAgentIdentities';
import type { AgentTaskPage, AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import { normalizeAgentTaskIntentRefs, type AgentTaskIntentRef } from '../../../../server/src/shared/mistAgentTasks';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { mistApiRequest } from './workspace';

export const COWORK_ACTIVE: ReadonlyArray<AgentTaskView['state']> = ['queued', 'running', 'waiting_time', 'waiting_condition', 'waiting_human'];
/** A bare status question in a conversation refers to the current task. */
export function isCurrentTaskStatusQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC').trim().replace(/[?。!]+$/u, '').trim();
  return /^(?:(?:这个任务|当前任务|任务)?(?:完成了没有|完成了吗|完成了没|做完了没有|做完了吗|做完了没|进度怎么样|做到哪一步了)|is (?:it|the task) done|what is the task status)$/i.test(normalized);
}

const REQUEST_MARK = '\n【本次请求】\n';
const CONTEXT_TURNS = 3, CONTEXT_REPLY = 300, THREAD_LIMIT = 90, LIST_PAGES = 3, INSTRUCTION_LIMIT = 4000, LEGACY_GAP_MS = 30 * 60_000;

/** 把此前几轮的问答压成一段上下文，随本次请求一起交给任务；展示时用 splitRequest 去掉。 */
export function composeInstructions(history: AgentTaskView[], text: string): string {
  const turns = history.filter(t => t.state === 'succeeded' && t.result).slice(-CONTEXT_TURNS);
  const message = text.trim();
  if (!turns.length) return message.slice(0, INSTRUCTION_LIMIT);
  const context = '【此前对话】\n' + turns.map(t => `我：${splitRequest(t.instructions)}\n小竹：${t.result.slice(0, CONTEXT_REPLY)}`).join('\n');
  const head = context.slice(0, Math.max(0, INSTRUCTION_LIMIT - REQUEST_MARK.length - message.length));
  return (head + REQUEST_MARK + message).slice(0, INSTRUCTION_LIMIT);
}
export function splitRequest(instructions: string): string {
  const at = instructions.indexOf(REQUEST_MARK);
  return at >= 0 ? instructions.slice(at + REQUEST_MARK.length) : instructions;
}

export type ConversationMeta = { id: string; title?: string; hidden?: true };
export type XiaozhuConversation = { id: string; title: string; startedAt: string; lastAt: string; tasks: AgentTaskView[]; active: boolean; legacy: boolean };
export const newConversationId = () => 'c_' + crypto.randomUUID().replace(/-/g, '');
export function selectedTaskIntentRefs(selected:ReadonlyArray<{id:string}>):AgentTaskIntentRef[]{
  return normalizeAgentTaskIntentRefs(selected.map(source=>{const at=source.id.indexOf(':');return{kind:source.id.slice(0,at),id:source.id.slice(at+1)};}));
}
/** 按对话归组（最新的在前）。早期没有对话编号的提问，相隔 30 分钟内的算同一段对话。 */
export function conversationsOf(tasks: AgentTaskView[], meta: ConversationMeta[] = []): XiaozhuConversation[] {
  const named = new Map(meta.map(m => [m.id, m]));
  const groups = new Map<string, AgentTaskView[]>(); let legacy: { id: string; at: number } | undefined;
  for (const t of [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    let key = t.conversationId;
    if (!key) { const at = Date.parse(t.createdAt); if (!legacy || at - legacy.at > LEGACY_GAP_MS) legacy = { id: 'legacy_' + t.id, at }; else legacy.at = at; key = legacy.id; }
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups].map(([id, list]) => ({ id, tasks: list, title: splitRequest(list[0].instructions).split('\n')[0].slice(0, 60) || list[0].name, startedAt: list[0].createdAt, lastAt: list.reduce((m, t) => t.updatedAt > m ? t.updatedAt : m, list[0].updatedAt), active: list.some(t => COWORK_ACTIVE.includes(t.state)), legacy: id.startsWith('legacy_') }))
    .filter(c => !named.get(c.id)?.hidden).map(c => { const title = named.get(c.id)?.title; return title ? { ...c, title } : c; })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** 本人对话设置（改名、从列表移除）：服务端按人保存，换设备也在；改动先本地生效，失败时回滚并报错。 */
export function useConversationMeta(workspaceId: string | undefined, enabled: boolean) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) + '/agent-conversations' : '';
  const [items, setItems] = React.useState<ConversationMeta[]>([]);
  React.useEffect(() => { setItems([]); if (!base || !enabled) return; let live = true; void (mistApiRequest(base) as Promise<{ items: ConversationMeta[] }>).then(r => { if (live) setItems(r.items); }, () => { /* 读不到时按默认标题显示 */ }); return () => { live = false; }; }, [base, enabled]);
  const save = async (id: string, change: { title?: string | null; hidden?: boolean }) => {
    const before = items;
    setItems(list => { const old = list.find(m => m.id === id), title = change.title === undefined ? old?.title : change.title || undefined, hidden = (change.hidden ?? old?.hidden) || undefined; const rest = list.filter(m => m.id !== id); return title || hidden ? [...rest, { id, ...(title ? { title } : {}), ...(hidden ? { hidden: true as const } : {}) }] : rest; });
    try { await mistApiRequest(base + '/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(change) }); } catch (e) { setItems(before); throw e; }
  };
  return { items, save };
}

const TASK_READ_TIMEOUT_MS = 5000;
const TASK_RETRY_INTERVAL_MS = 1000;
const TASK_RETRY_MAX_MS = 8000;

async function readCoworkTask(base: string, id: string, signal: AbortSignal): Promise<AgentTaskView> {
  if (signal.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(() => controller.abort(new Error('任务暂时无法核对')), TASK_READ_TIMEOUT_MS);
  // Release the poll slot at the deadline even if response processing does not settle promptly.
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  try {
    const { item } = await Promise.race([
      mistApiRequest(base + '/agent-tasks/' + encodeURIComponent(id), { cache: 'no-store', signal: controller.signal }) as Promise<{ item: AgentTaskView }>,
      interrupted,
    ]);
    if (item?.id !== id) throw new Error('任务暂时无法核对');
    return item;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function useXiaozhuCowork(workspaceId: string | undefined, scope: string, enabled: boolean, visibleConversationId?: string) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [available, setAvailable] = React.useState(false), [tasks, setTasks] = React.useState<AgentTaskView[]>([]);
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [more, setMore] = React.useState<string | undefined>(undefined);
  const [staleTask, setStaleTask] = React.useState<{ scope: string; id: string }>();
  const live = React.useRef(scope); live.current = scope;
  const version = React.useRef(0), pending = React.useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const lastAvailability=React.useRef<{scope:string;available:boolean}|null>(null);
  const load = React.useCallback(async () => {
    const run = ++version.current, bound = scope;
    if (!base || !enabled) { setLoading(false); setAvailable(false); return; }
    setLoading(true);setError('');
    try {
      const [mine, page, caps] = await Promise.all([
        mistApiRequest(base + '/agent-identities?scope=mine') as Promise<{ items: AgentIdentityView[] }>,
        (async () => { const items: AgentTaskView[] = []; let cursor: string | undefined; for (let i = 0; i < LIST_PAGES; i++) { const page = await mistApiRequest(base + '/agent-tasks' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')) as AgentTaskPage; items.push(...page.items); cursor = page.nextCursor ?? undefined; if (!cursor) break; } return { items, cursor }; })(),
        mistApiRequest(base + '/agent-task-capabilities') as Promise<{ platformAvailable: boolean }>,
      ]);
      if (run !== version.current || live.current !== bound) return;
      const own = mine.items.find(i => i.kind === 'personal') ?? null;
      const nextAvailable=caps.platformAvailable === true && own?.state !== 'disabled';lastAvailability.current={scope:bound,available:nextAvailable};setAvailable(nextAvailable);
      setTasks(page.items.filter(t => t.executor === 'platform' && (!own || t.identityId === own.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-THREAD_LIMIT)); setMore(page.cursor);
      setError('');
    } catch (e) {
      // A failed read cannot establish that the task channel is unavailable, or replace a known conversation mode.
      if (run === version.current && live.current === bound) { setAvailable(lastAvailability.current?.scope===bound?lastAvailability.current.available:false); setError(e instanceof Error ? e.message : '读取失败'); }
    } finally { if (run === version.current && live.current === bound) setLoading(false); }
  }, [base, enabled, scope]);
  React.useEffect(() => { setTasks([]); setAvailable(false); setLoading(true);lastAvailability.current=null; pending.current = undefined; void load(); return () => { version.current++; }; }, [load]);
  const activeTasks = tasks.filter(t => COWORK_ACTIVE.includes(t.state));
  const foregroundId = activeTasks.filter(t => visibleConversationId && t.conversationId === visibleConversationId
    && (t.state === 'running' || t.state === 'queued')).at(-1)?.id;
  const progressId = foregroundId ?? activeTasks.filter(t => visibleConversationId && t.conversationId === visibleConversationId).at(-1)?.id;
  const progressStale = !!progressId && staleTask?.scope === scope && staleTask.id === progressId;
  const backgroundIds = activeTasks.filter(t => t.id !== foregroundId).map(t => t.id).join(',');
  React.useEffect(() => {
    if ((!foregroundId && !backgroundIds) || !base || !available) return;
    const controller = new AbortController();
    const background = backgroundIds ? backgroundIds.split(',') : [];
    const inFlight = new Set<string>();
    const retry = new Map<string, { delay: number; at: number }>();
    let lastBackground = 0;
    const poll = () => {
      if (controller.signal.aborted || live.current !== scope || document.visibilityState === 'hidden') return;
      const ids = foregroundId ? [foregroundId] : [];
      const now = Date.now();
      if (background.length && now - lastBackground >= 3000) {
        ids.push(...background);
        lastBackground = now;
      }
      for (const id of ids) {
        if (inFlight.has(id) || now < (retry.get(id)?.at ?? 0)) continue;
        inFlight.add(id);
        void readCoworkTask(base, id, controller.signal)
          .then(next => {
            if (controller.signal.aborted || live.current !== scope) return;
            retry.delete(id);
            setTasks(old => old.map(task => {
              if (task.id !== id || next.updatedAt < task.updatedAt) return task;
              return task.conversationId && !next.conversationId ? { ...next, conversationId: task.conversationId } : next;
            }));
            if (progressId === id) setStaleTask(old => old?.scope === scope && old.id === id ? undefined : old);
          })
          .catch(() => {
            if (controller.signal.aborted || live.current !== scope) return;
            const previous = retry.get(id);
            const delay = previous ? Math.min(TASK_RETRY_MAX_MS, previous.delay * 2) : TASK_RETRY_INTERVAL_MS;
            retry.set(id, { delay, at: Date.now() + delay });
            if (progressId === id) setStaleTask(old => old?.scope === scope && old.id === id ? old : { scope, id });
          })
          .finally(() => inFlight.delete(id));
      }
    };
    const refreshVisible = () => { lastBackground = 0; void poll(); };
    const timer = window.setInterval(() => void poll(), foregroundId ? 1000 : 3000);
    document.addEventListener('visibilitychange', refreshVisible);
    void poll();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [foregroundId, backgroundIds, progressId, base, available, scope]);
  const post = async (path: string, body: object) => mistApiRequest(base + path, { method: 'POST', body: JSON.stringify(body) }) as Promise<{ item?: AgentTaskView }>;
  const send = async (text: string, history: AgentTaskView[] = [], conversationId?: string, intentRefs:AgentTaskIntentRef[]=[], files:File[]=[]): Promise<AgentTaskView | null> => {
    const message = text.trim(); if (!message || busy || !base||loading||error||!available) return null;
    const bound = scope; setBusy(true); setError('');
    try {
      const refs=normalizeAgentTaskIntentRefs(intentRefs);
      const input = { name: message.slice(0, 60), instructions: composeInstructions(history, message), locale: interfaceLocale(), ...(conversationId ? { conversationId } : {}),...(refs.length?{intentRefs:refs}:{}) };
      const fileIdentity=await Promise.all(files.map(async file=>{
        const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
        return [file.name,file.type,file.size,Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')];
      }));
      if(live.current!==bound)return null;
      const fingerprint = JSON.stringify([base, input, fileIdentity]);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
      const body={requestId:pending.current.id,...input};
      let r:{item:AgentTaskView};
      if(files.length){
        const form=new FormData();
        form.append('task',JSON.stringify(body));
        for(const file of files)form.append('attachments',file);
        r=await mistApiRequest(base+'/personal-agent/tasks',{method:'POST',body:form});
      }else r=await post('/personal-agent/tasks',body) as {item:AgentTaskView};
      if (live.current !== bound) return null;
      pending.current = undefined; const item = conversationId && !r.item.conversationId ? { ...r.item, conversationId } : r.item; setTasks(old => [...old.filter(t => t.id !== item.id), item]); return item;
    } catch (e) { if (live.current === bound) setError(e instanceof Error ? e.message : '未能交给小竹'); return null; }
    finally { if (live.current === bound) setBusy(false); }
  };
  const refreshTask = async (taskId: string, signal: AbortSignal) => {
    const bound = scope;
    const item = await readCoworkTask(base, taskId, signal);
    if (signal.aborted || live.current !== bound) return;
    setStaleTask(old => old?.scope === bound && old.id === taskId ? undefined : old);
    setTasks(old => old.map(task => task.id === taskId && item.updatedAt >= task.updatedAt
      ? { ...item, conversationId: item.conversationId ?? task.conversationId } : task));
    return item;
  };
  const loadMore = async () => {
    if (!more || !base) return; const cursor = more; setMore(undefined);
    try {
      const page = await mistApiRequest(base + '/agent-tasks?cursor=' + encodeURIComponent(cursor)) as AgentTaskPage;
      const own = new Set(tasks.map(t => t.identityId));
      setTasks(old => { const seen = new Set(old.map(t => t.id)); return [...page.items.filter(t => t.executor === 'platform' && (!own.size || own.has(t.identityId)) && !seen.has(t.id)), ...old].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); });
      setMore(page.nextCursor ?? undefined);
    } catch (e) { setMore(cursor); setError(e instanceof Error ? e.message : '读取失败'); }
  };
  const replace = (item?: AgentTaskView) => { if (item) setTasks(old => old.map(t => t.id === item.id ? item : t)); };
  const answer = async (task: AgentTaskView, questionId: string, text: string) => {
    try { replace((await post('/agent-tasks/' + encodeURIComponent(task.id) + '/answer', { requestId: crypto.randomUUID(), version: task.version, questionId, answer: text.trim() })).item); } catch (e) { setError(e instanceof Error ? e.message : '回答未送达'); await load(); }
  };
  const cancel = async (task: AgentTaskView) => {
    try { await post('/agent-tasks/' + encodeURIComponent(task.id) + '/cancel', { requestId: crypto.randomUUID(), version: task.version }); } catch (e) { setError(e instanceof Error ? e.message : '未能停止'); } finally { await load(); }
  };
  return { available, tasks: tasks.filter(t => !t.automationId), all: tasks, loading, error, progressStale, busy, send, refreshTask, answer, cancel, reload: load, loadMore, hasMore: !!more, track: (task: AgentTaskView) => setTasks(old => [...old.filter(t => t.id !== task.id), task]) };
}
