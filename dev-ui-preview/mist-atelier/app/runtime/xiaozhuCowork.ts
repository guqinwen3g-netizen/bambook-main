import {withRequestDeadline} from './requestDeadline';
import type {TaskControlRequest} from './assistantConversation';
/**
 * 小竹的 cowork（2026-11-07 定案）：对话里的每一条请求就是一项交给小竹的平台任务，
 * 小竹经平台 AI 与 MCP 业务工具办理，进度、追问和待确认事项回到同一条对话里；对话由服务端任务记录承载，换设备也在。
 * 需要确认的写入仍只留提议，等本人在「接着完成」确认。
 */
import React from 'react';
import type { AgentIdentityView } from '../../../../server/src/shared/mistAgentIdentities';
import type { AgentTaskPage, AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import type { TaskAttachmentRef } from '../../../../server/src/shared/mistTaskAttachments';
import { readPendingSubmissions, savePendingSubmissions, submissionDraftKey, submissionFingerprint, type PendingSubmission } from './xiaozhuSubmissions';
import { normalizeAgentTaskIntentRefs, TASK_ACCESS_BATCH_LIMIT, type AgentTaskIntentRef } from '../../../../server/src/shared/mistAgentTasks';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { mistApiRequest } from './workspace';
import { splitTaskRequest as splitRequest, TASK_HISTORY_TURNS, TASK_INSTRUCTION_LIMIT } from '../../../../server/src/shared/mistTaskHistoryText';
export { splitRequest, TASK_INSTRUCTION_LIMIT };

export const COWORK_ACTIVE: ReadonlyArray<AgentTaskView['state']> = ['queued', 'running', 'waiting_time', 'waiting_condition', 'waiting_human'];
/** A bare status question in a conversation refers to the current task. */
export function isCurrentTaskStatusQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC').trim().replace(/[?。!]+$/u, '').trim();
  return /^(?:(?:这个任务|当前任务|任务)?(?:完成了没有|完成了吗|完成了没|做完了没有|做完了吗|做完了没|进度怎么样|做到哪一步了)|is (?:it|the task) done|what is the task status)$/i.test(normalized);
}

const THREAD_LIMIT = 90, LIST_PAGES = 3, LEGACY_GAP_MS = 30 * 60_000;

function textPrefix(value: string, limit: number) {
  const prefix = value.slice(0,limit);
  return prefix.length < value.length ? prefix.replace(/[\uD800-\uDBFF]$/u,'') : prefix;
}

export function formatTaskQuestion(question: string, sources: ReadonlyArray<{label:string}>) {
  const text = question.trim();
  if (!sources.length) return text;
  const footer = '\n（引用业务记录：'+sources.map(source=>source.label).join('、')+'）';
  // The structured intent references are sent separately even when the display footer does not fit.
  return text.length + footer.length <= TASK_INSTRUCTION_LIMIT ? text + footer : text;
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
const HISTORY_READ_TIMEOUT_MS = 10_000;
const TASK_SEND_TIMEOUT_MS = 45_000;
const UPLOAD_BYTES_PER_SECOND = 64 * 1024;
const TASK_RETRY_INTERVAL_MS = 1000;
const TASK_RETRY_MAX_MS = 8000;
const REPORT_ACCESS_INTERVAL_MS = 10_000;

function restrictReport(task: AgentTaskView): AgentTaskView {
  return { ...task, contentRestricted: true, name: 'Agent任务', instructions: '', checkpoint: '', result: '',
    canControl: false, attachments: undefined, intentRefs: undefined, trail: undefined, questions: [],
    waitingProposalIds: [], resumeAt: null, waitingFor: null, nextCheckAt: null, requiredRead: null };
}

async function readCoworkTask(base: string, id: string, signal: AbortSignal): Promise<AgentTaskView> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const { item } = await withRequestDeadline(controller, TASK_READ_TIMEOUT_MS, '任务暂时无法核对', signal =>
      mistApiRequest(base + '/agent-tasks/' + encodeURIComponent(id), { cache: 'no-store', signal }) as Promise<{ item: AgentTaskView }>);
    if (item?.id !== id) throw new Error('任务暂时无法核对');
    return item;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function readCoworkHistory(base: string, signal: AbortSignal) {
  const items: AgentTaskView[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < LIST_PAGES; i++) {
    signal.throwIfAborted();
    const page = await mistApiRequest(base + '/agent-tasks' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), { signal }) as AgentTaskPage;
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { items, cursor };
}

function mergeTaskUpdate(previous: AgentTaskView, next: AgentTaskView): AgentTaskView {
  if (previous.id !== next.id || previous.identityId !== next.identityId || previous.executor !== next.executor
    || next.version < previous.version || next.updatedAt < previous.updatedAt) return previous;
  return previous.conversationId && !next.conversationId ? { ...next, conversationId: previous.conversationId } : next;
}

export type TaskControlState = { busy: boolean; error?: string };
const CONTROL_FAILURE={answer:'回答未确认，可重试',cancel:'停止结果未确认，可重试'};

export function useXiaozhuCowork(workspaceId: string | undefined, scope: string, enabled: boolean, visibleConversationId?: string, originTaskId?: string, savedControls?:Map<string,TaskControlRequest>) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [available, setAvailable] = React.useState(false), [cachedTasks, setTasks] = React.useState<AgentTaskView[]>([]);
  const [reportAccess, setReportAccess] = React.useState<{scope:string; restricted:Set<string>}>();
  const tasks = React.useMemo(() => cachedTasks.map(task => reportAccess?.scope === scope && reportAccess.restricted.has(task.id)
    ? restrictReport(task) : task), [cachedTasks, reportAccess, scope]);
  const restrictedReports = React.useRef(new Set<string>());
  const currentTasks = React.useRef(tasks);
  currentTasks.current = tasks;
  const [checkingAvailability, setCheckingAvailability] = React.useState(true);
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [more, setMore] = React.useState<string | undefined>(undefined);
  const [staleProgress, setStaleProgress] = React.useState<{ scope: string; ids: ReadonlySet<string> }>();
  const clearStaleProgress = React.useCallback((id: string) => setStaleProgress(old => {
    if (old?.scope !== scope || !old.ids.has(id)) return old;
    const ids = new Set(old.ids);
    ids.delete(id);
    return ids.size ? { scope, ids } : undefined;
  }), [scope]);
  const live = React.useRef(scope); live.current = scope;
  const origin = React.useRef(originTaskId); origin.current = originTaskId;
  const trackedOrigin = React.useRef<{scope:string;id:string}|undefined>(undefined);
  const deniedHistory = React.useRef(0);
  const version = React.useRef(0);
  const pending = React.useRef(new Map<string, PendingSubmission>());
  const [recoveredSubmissions, setRecoveredSubmissions] = React.useState<Array<PendingSubmission&{fingerprint:string}>>([]);
  const receiptRead = React.useRef<AbortController|undefined>(undefined);
  const [checkingReceipt,setCheckingReceipt] = React.useState(false);
  const sendRequest = React.useRef<AbortController | undefined>(undefined);
  const controlRequests = React.useRef(new Map<string,AbortController>());
  const localControls=React.useMemo(()=>new Map<string,TaskControlRequest>(),[scope]);
  const controlKeys=savedControls??localControls;
  React.useEffect(()=>{
    for(const task of tasks){
      const pending=controlKeys.get(task.id);
      if(pending&&(task.version>pending.version||task.contentRestricted||task.canControl===false))controlKeys.delete(task.id);
    }
  },[controlKeys,tasks]);
  const [controls,setControls] = React.useState<Record<string,TaskControlState>>({});
  const [sendFailure, setSendFailure] = React.useState<{conversationId?: string; message: string}>();
  const sendError = !visibleConversationId || sendFailure?.conversationId === visibleConversationId ? sendFailure?.message ?? '' : '';
  const historyRead = React.useRef<AbortController | undefined>(undefined);
  const capabilityRead = React.useRef<AbortController | undefined>(undefined);
  const moreRead = React.useRef<AbortController | undefined>(undefined);
  const [loadingMore, setLoadingMore] = React.useState(false), [moreError, setMoreError] = React.useState('');
  const personalIdentity = React.useRef<string | undefined>(undefined);
  const lastAvailability=React.useRef<{scope:string;available:boolean}|null>(null);
  const checkReceipts = React.useCallback(async (automatic: boolean, conversation?: string) => {
    if (!base || !enabled || receiptRead.current || sendRequest.current) return;
    const missing = [...pending.current].filter(([,entry]) => automatic ? entry.recoveredFromStorage
      : (entry.sourceConversationId??entry.conversationId) === conversation);
    if (!missing.length) return;
    const controller = new AbortController();
    receiptRead.current=controller;setCheckingReceipt(true);
    const current=()=>live.current===scope&&receiptRead.current===controller;
    try {
      const replies = await withRequestDeadline(controller, HISTORY_READ_TIMEOUT_MS, '提交结果暂时无法核对', signal =>
        Promise.allSettled(missing.map(async ([fingerprint,entry]) => {
          const {item:task} = await mistApiRequest(base + '/personal-agent/tasks/receipt/' + encodeURIComponent(entry.requestId), {signal,cache:'no-store'}) as {item:AgentTaskView};
          if (!task?.id || task.executor !== 'platform' || task.conversationId !== entry.conversationId)
            throw new Error('提交结果暂时无法核对');
          if (signal.aborted || !current() || pending.current.get(fingerprint)!==entry) return;
          pending.current.delete(fingerprint);
          savePendingSubmissions(scope,pending.current);
          setTasks(old=>{
            const existing=old.find(item=>item.id===task.id);
            return existing ? old.map(item=>mergeTaskUpdate(item,task))
              : [...old,task].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
          });
          setSendFailure(old=>old&&(entry.sourceConversationId??entry.conversationId)===old.conversationId?undefined:old);
          setRecoveredSubmissions(old=>[...old,{...entry,fingerprint}]);
        })));
      if (!current() || automatic) return;
      const unresolved=replies.filter((_,index)=>{
        const [fingerprint,entry]=missing[index];
        return pending.current.get(fingerprint)===entry;
      });
      if(unresolved.length)setSendFailure({conversationId:conversation,message:unresolved.every(reply=>reply.status==='rejected'&&reply.reason?.status===404)
        ?'暂未查到原提交回执':'提交结果暂时无法核对'});
    } catch {
      if (current()&&!automatic)setSendFailure({conversationId:conversation,message:'提交结果暂时无法核对'});
    } finally {
      if(current()){receiptRead.current=undefined;setCheckingReceipt(false);}
    }
  },[base,enabled,scope]);
  const load = React.useCallback(async () => {
    const run = ++version.current, bound = scope;
    historyRead.current?.abort();
    capabilityRead.current?.abort();
    moreRead.current?.abort();
    moreRead.current = undefined;
    setLoadingMore(false);
    setMoreError('');
    if (!base || !enabled) { setLoading(false); setCheckingAvailability(false); setAvailable(false); return; }
    const controller = new AbortController(), capabilityController = new AbortController();
    historyRead.current = controller;
    capabilityRead.current = capabilityController;
    const current = () => run === version.current && live.current === bound;
    setLoading(true);setCheckingAvailability(true);setError('');
    const capability = withRequestDeadline(capabilityController, HISTORY_READ_TIMEOUT_MS, '任务服务检查超时', signal =>
      mistApiRequest(base + '/agent-task-capabilities', { signal }) as Promise<{ platformAvailable: boolean }>
    ).then(caps => ({ caps }), error => ({ error }));
    try {
      const [mine, page] = await withRequestDeadline(controller, HISTORY_READ_TIMEOUT_MS, '对话读取超时', signal => Promise.all([
        mistApiRequest(base + '/agent-identities?scope=mine', { signal }) as Promise<{ items: AgentIdentityView[] }>,
        readCoworkHistory(base, signal),
      ]));
      if (run !== version.current || live.current !== bound) return;
      const own = mine.items.find(i => i.kind === 'personal') ?? null;
      personalIdentity.current = own?.id;
      const visible = page.items.filter(t => t.executor === 'platform' && (!own || t.identityId === own.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-THREAD_LIMIT);
      setTasks(old => {
        const previous = new Map(old.map(task => [task.id, task]));
        const history = visible.map(task => {
          const prior = previous.get(task.id);
          return prior ? mergeTaskUpdate(prior, task) : task;
        });
        // The exact source may be older than the bounded history, even on a successful list read.
        const tracked = trackedOrigin.current;
        const retained = tracked?.scope === bound && tracked.id === origin.current ? previous.get(tracked.id) : undefined;
        return retained && (!own || retained.identityId === own.id) && !history.some(task => task.id === retained.id)
          ? [...history, retained].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : history;
      });
      setMore(page.cursor);
      setLoading(false);
      setError('');

      await checkReceipts(true);
      const result = await capability;
      if (!current()) return;
      if ('error' in result) throw result.error;
      const nextAvailable = result.caps.platformAvailable === true && own?.state !== 'disabled';
      lastAvailability.current = {scope:bound, available:nextAvailable};
      setAvailable(nextAvailable);
    } catch (e) {
      // A failed read cannot establish that the task channel is unavailable, or replace a known conversation mode.
      if (current()) {
        if ([401,403,404].includes(Number((e as {status?:number})?.status))) {
          deniedHistory.current++;trackedOrigin.current=undefined;
          setTasks([]);setMore(undefined);personalIdentity.current=undefined;lastAvailability.current=null;
        }
        setAvailable(lastAvailability.current?.scope===bound?lastAvailability.current.available:false);
        setError(e instanceof Error ? e.message : '读取失败');
      }
    } finally {
      controller.abort();
      capabilityController.abort();
      if (historyRead.current === controller) historyRead.current = undefined;
      if (capabilityRead.current === capabilityController) capabilityRead.current = undefined;
      if (current()) { setLoading(false); setCheckingAvailability(false); }
    }
  }, [base, enabled, scope, checkReceipts]);
  React.useEffect(() => { restrictedReports.current = new Set(); setReportAccess(undefined); setTasks([]); setMore(undefined); setAvailable(false); setLoading(true);personalIdentity.current=undefined;lastAvailability.current=null; pending.current=readPendingSubmissions(scope); setRecoveredSubmissions([]); setCheckingReceipt(false); setControls({});  setBusy(false); setSendFailure(undefined); void load(); return () => { version.current++; historyRead.current?.abort(); capabilityRead.current?.abort(); moreRead.current?.abort(); receiptRead.current?.abort(); receiptRead.current=undefined; sendRequest.current?.abort(); sendRequest.current=undefined; for(const controller of controlRequests.current.values())controller.abort(); controlRequests.current.clear(); }; }, [load,scope]);
  const openReportIds = React.useMemo(() => {
    if (!visibleConversationId) return '';
    const personal = cachedTasks.filter(task => !task.automationId);
    const reports = visibleConversationId.startsWith('legacy_')
      ? conversationsOf(personal.filter(task => !task.conversationId)).find(conversation => conversation.id === visibleConversationId)?.tasks ?? []
      : personal.filter(task => task.conversationId === visibleConversationId);
    return reports.map(task => task.id).join(',');
  }, [cachedTasks, visibleConversationId]);
  React.useEffect(() => {
    if (!base || !enabled || !openReportIds) return;
    const ids = openReportIds.split(',');
    let request: AbortController | undefined;
    const poll = async () => {
      if (request || document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      request = controller;
      const current = () => request === controller && live.current === scope;
      const restricted = new Set(restrictedReports.current);
      const readable = new Set<string>();
      try {
        await withRequestDeadline(controller, TASK_READ_TIMEOUT_MS, '任务暂时无法核对', async signal => {
          for (let offset = 0; offset < ids.length; offset += TASK_ACCESS_BATCH_LIMIT) {
            signal.throwIfAborted();
            const batch = ids.slice(offset, offset + TASK_ACCESS_BATCH_LIMIT);
            const result = await mistApiRequest(base + '/personal-agent/task-access?taskIds=' + encodeURIComponent(batch.join(',')),
              { signal, cache: 'no-store' }) as { restrictedIds?: string[] };
            if (!Array.isArray(result.restrictedIds) || result.restrictedIds.some(id => !batch.includes(id))) continue;
            for (const id of batch) if (!result.restrictedIds.includes(id)) readable.add(id);
            for (const id of result.restrictedIds) restricted.add(id);
          }
        });
      } catch (error) {
        if ([401, 403, 404].includes(Number((error as {status?: number})?.status))) {
          for (const id of ids) restricted.add(id);
          readable.clear();
        }
      }
      if (!current()) return;
      const prior = restrictedReports.current;
      if (restricted.size !== prior.size) {
        restrictedReports.current = restricted;
        setReportAccess({ scope, restricted });
        setTasks(old => old.map(task => restricted.has(task.id) && !task.contentRestricted ? restrictReport(task) : task));
      }
      // Reopen a restricted report only after a fresh full read under the new authority.
      const toRestore = currentTasks.current.filter(task => readable.has(task.id) && task.contentRestricted).slice(0, 4);
      const restored = await Promise.allSettled(toRestore.map(task => readCoworkTask(base, task.id, controller.signal)));
      if (!current()) return;
      const confirmed = new Map(restored.flatMap(reply => reply.status === 'fulfilled' && !reply.value.contentRestricted
        ? [[reply.value.id, reply.value] as const] : []));
      if (confirmed.size) {
        const remaining = new Set([...restrictedReports.current].filter(id => !confirmed.has(id)));
        restrictedReports.current = remaining;
        setTasks(old => old.map(item => {
          const next = confirmed.get(item.id);
          return next ? mergeTaskUpdate(item, next) : item;
        }));
        setReportAccess({ scope, restricted: remaining });
      }
      request = undefined;
    };
    const wake = () => void poll();
    const timer = window.setInterval(wake, REPORT_ACCESS_INTERVAL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    wake();
    return () => {
      const previous = request;
      request = undefined;
      previous?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [base, enabled, openReportIds, scope]);
  const activeTasks = tasks.filter(t => COWORK_ACTIVE.includes(t.state));
  const foregroundId = activeTasks.filter(t => visibleConversationId && t.conversationId === visibleConversationId
    && (t.state === 'running' || t.state === 'queued')).at(-1)?.id;
  const staleProgressIds = staleProgress?.scope === scope ? staleProgress.ids : undefined;
  const backgroundIds = activeTasks.filter(t => t.id !== foregroundId).map(t => t.id).join(',');
  React.useEffect(() => {
    if ((!foregroundId && !backgroundIds) || !base || !available) return;
    const background = backgroundIds ? backgroundIds.split(',') : [];
    const inFlight = new Map<string, AbortController>();
    const retry = new Map<string, { delay: number; at: number }>();
    let lastBackground = 0;
    const markStale = (ids: string[]) => setStaleProgress(old => {
      const previous = old?.scope === scope ? old.ids : undefined;
      if (previous && ids.every(id => previous.has(id))) return old;
      return { scope, ids: new Set([...(previous ?? []), ...ids]) };
    });
    const poll = () => {
      if (live.current !== scope || !navigator.onLine || document.visibilityState === 'hidden') return;
      const ids = foregroundId ? [foregroundId] : [];
      const now = Date.now();
      if (background.length && now - lastBackground >= 3000) {
        ids.push(...background);
        lastBackground = now;
      }
      for (const id of ids) {
        if (inFlight.has(id) || now < (retry.get(id)?.at ?? 0)) continue;
        const request = new AbortController();
        inFlight.set(id, request);
        void readCoworkTask(base, id, request.signal)
          .then(next => {
            if (request.signal.aborted || live.current !== scope) return;
            retry.delete(id);
            setTasks(old => old.map(task => mergeTaskUpdate(task, next)));
            clearStaleProgress(id);
          })
          .catch(() => {
            if (request.signal.aborted || live.current !== scope) return;
            const previous = retry.get(id);
            const delay = previous ? Math.min(TASK_RETRY_MAX_MS, previous.delay * 2) : TASK_RETRY_INTERVAL_MS;
            retry.set(id, { delay, at: Date.now() + delay });
            markStale([id]);
          })
          .finally(() => { if (inFlight.get(id) === request) inFlight.delete(id); });
      }
    };
    const abortReads = () => {
      for (const request of inFlight.values()) request.abort();
      inFlight.clear();
    };
    const offline = () => { abortReads(); markStale(foregroundId ? [foregroundId, ...background] : background); };
    const refreshVisible = () => { lastBackground = 0; void poll(); };
    const reconnect = () => { retry.clear(); refreshVisible(); };
    const timer = window.setInterval(poll, foregroundId ? 1000 : 3000);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    if (navigator.onLine) poll();
    else offline();
    return () => {
      abortReads();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', reconnect);
    };
  }, [foregroundId, backgroundIds, base, available, scope, clearStaleProgress]);
  const send = async (text: string, history: AgentTaskView[] = [], conversationId?: string, intentRefs:AgentTaskIntentRef[]=[], files:File[]=[], attachmentRefs:ReadonlyArray<TaskAttachmentRef>=[]): Promise<AgentTaskView | null> => {
    const message = text.trim();
    if (!message || sendRequest.current || receiptRead.current || !base || loading || checkingAvailability || error || !available) return null;
    const bound = scope, controller = new AbortController();
    sendRequest.current = controller;
    const isCurrent = () => live.current === bound && sendRequest.current === controller;
    setBusy(true);
    setSendFailure(undefined);
    setRecoveredSubmissions(old=>old.filter(entry=>(entry.sourceConversationId??entry.conversationId)!==(visibleConversationId??conversationId)));
    let firstAttempt: string | undefined, attemptedFingerprint: string | undefined;
    try {
      const refs = normalizeAgentTaskIntentRefs(intentRefs);
      const fingerprint = await submissionFingerprint(visibleConversationId??conversationId,message,refs,attachmentRefs,files);
      if (!isCurrent()) return null;
      attemptedFingerprint=fingerprint;

      // A receipt can be lost after commit. A refreshed thread must not change the original POST.
      let saved = pending.current.get(fingerprint);
      if (!saved) {
        const draftKey = submissionDraftKey(message,refs);
        if ([...pending.current.values()].some(entry=>entry.recoveredFromStorage && entry.hasAttachments
          && (entry.sourceConversationId??entry.conversationId)===(visibleConversationId??conversationId) && entry.draftKey===draftKey))
          throw new Error('请恢复原附件后重试，或先核对提交结果');
        if (message.length > TASK_INSTRUCTION_LIMIT) throw new Error('问题超过 4000 字，请缩短后重试');
        const historyTaskIds = conversationId ? [...new Set(history
          .filter(task=>task.conversationId===conversationId&&task.executor==='platform'&&task.state==='succeeded'&&task.result)
          .map(task=>task.id))].slice(-TASK_HISTORY_TURNS) : [];
        saved = { requestId: crypto.randomUUID(), instructions: message, historyTaskIds, locale: interfaceLocale(),
          conversationId, sourceConversationId:visibleConversationId??conversationId, draftKey, hasAttachments:!!(files.length||attachmentRefs.length) };
        pending.current.set(fingerprint, saved);
        savePendingSubmissions(bound,pending.current);
        firstAttempt = fingerprint;
      }
      const {requestId,instructions,locale,historyTaskIds} = saved;
      const target = saved.conversationId;
      const body = { requestId,instructions,locale,name: textPrefix(message,60), ...(target ? { conversationId:target } : {}),
        ...(historyTaskIds !== undefined ? { historyTaskIds } : {}), ...(refs.length ? { intentRefs: refs } : {}), ...(attachmentRefs.length ? { attachmentRefs } : {}) };
      let submission: RequestInit = { method: 'POST', body: JSON.stringify(body) };
      if (files.length) {
        const form = new FormData();
        form.append('task', JSON.stringify(body));
        for (const file of files) form.append('attachments',file);
        submission = { method: 'POST', body: form };
      }
      const uploadSeconds = Math.ceil(files.reduce((bytes,file) => bytes + file.size, 0) / UPLOAD_BYTES_PER_SECOND);
      const result = await withRequestDeadline(controller, TASK_SEND_TIMEOUT_MS + uploadSeconds * 1000, '提交结果待核对', signal =>
        mistApiRequest(base + '/personal-agent/tasks', { ...submission, signal }) as Promise<{item: AgentTaskView}>);
      if (!isCurrent()) return null;
      if (!result.item?.id || result.item.conversationId && result.item.conversationId !== target)
        throw new Error('提交结果待核对');

      pending.current.delete(fingerprint);
      savePendingSubmissions(bound,pending.current);
      const item = target && !result.item.conversationId ? { ...result.item, conversationId:target } : result.item;
      setTasks(old => old.some(task => task.id === item.id)
        ? old.map(task => mergeTaskUpdate(task,item))
        : [...old,item]);
      window.dispatchEvent(new Event('bambook:agent-task-update'));
      return item;
    } catch (e) {
      if (isCurrent()) {
        const status = (e as {status?:number})?.status;
        // An explicit first-request rejection is different from a lost receipt or an uncertain retry.
        if (firstAttempt && status && status >= 400 && status < 500 && ![408,409].includes(status)) {
          pending.current.delete(firstAttempt);
          savePendingSubmissions(bound,pending.current);
        }
        const uncertain=!!attemptedFingerprint&&pending.current.has(attemptedFingerprint)&&(!status||status===408||status>=500);
        const message=uncertain?'提交结果待核对':e instanceof Error?e.message:'未能交给小竹';
        setSendFailure({conversationId:visibleConversationId??conversationId,message});
      }
      return null;
    } finally {
      if (isCurrent()) {
        sendRequest.current = undefined;
        setBusy(false);
      }
    }
  };
  const applyTaskUpdate = (item?: AgentTaskView) => {
    if (!item || live.current !== scope) return;
    setTasks(old => old.map(task => mergeTaskUpdate(task, item)));
  };
  const track = (task: AgentTaskView) => setTasks(old => old.some(item=>item.id===task.id)
    ? old.map(item=>mergeTaskUpdate(item,task)) : [...old,task]);
  const refreshTask = async (taskId: string, signal: AbortSignal, {retainOrigin = false}: {retainOrigin?: boolean} = {}) => {
    const bound = scope, denial = deniedHistory.current;
    const item = await readCoworkTask(base, taskId, signal);
    if (signal.aborted || live.current !== bound) return;
    if (deniedHistory.current !== denial) throw new Error('任务暂时无法核对');
    clearStaleProgress(taskId);
    if (retainOrigin && origin.current === item.id && item.executor === 'platform' && !item.automationId
      && item.conversationId && item.state !== 'access_changed') {
      trackedOrigin.current = {scope:bound,id:item.id};
      track(item);
    } else applyTaskUpdate(item);
    return item;
  };
  const loadMore = async () => {
    if (!more || !base || !enabled || loading || moreRead.current) return;
    const cursor = more, run = version.current, bound = scope, controller = new AbortController();
    const isCurrent = () => moreRead.current === controller && run === version.current && live.current === bound;
    moreRead.current = controller;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await withRequestDeadline(controller, HISTORY_READ_TIMEOUT_MS, '对话读取超时', signal =>
        mistApiRequest(base + '/agent-tasks?cursor=' + encodeURIComponent(cursor), { signal }) as Promise<AgentTaskPage>);
      if (!isCurrent()) return;
      const own = personalIdentity.current;
      setTasks(old => {
        const seen = new Set(old.map(t => t.id));
        const older = page.items.filter(t => t.executor === 'platform' && (!own || t.identityId === own) && !seen.has(t.id));
        return [...older, ...old].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      setMore(page.nextCursor ?? undefined);
    } catch (e) {
      if (isCurrent()) setMoreError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (isCurrent()) {
        moreRead.current = undefined;
        setLoadingMore(false);
      }
    }
  };
  const controlTask = async (task:AgentTaskView, action:'answer'|'cancel', details:Record<string,string>, confirmed:(item:AgentTaskView)=>boolean) => {
    if (!base || !enabled || controlRequests.current.has(task.id)) return;
    let controller = new AbortController();
    const isCurrent = () => live.current===scope && controlRequests.current.get(task.id)===controller;
    controlRequests.current.set(task.id,controller);
    setControls(old=>({...old,[task.id]:{busy:true}}));

    const body = {version:task.version,...details};
    const key = JSON.stringify([action,body]);
    const existing = controlKeys.get(task.id);
    const requestId = existing?.key===key ? existing.requestId : crypto.randomUUID();
    controlKeys.set(task.id,{action,version:task.version,key,requestId});
    const failure = CONTROL_FAILURE[action];
    let error = '';
    const accept = (item:AgentTaskView) => {
      if (!isCurrent()) return;
      applyTaskUpdate(item);
      controlKeys.delete(task.id);
      window.dispatchEvent(new Event('bambook:agent-task-update'));
    };

    try {
      const result = await withRequestDeadline(controller,HISTORY_READ_TIMEOUT_MS,failure,signal =>
        mistApiRequest(base+'/agent-tasks/'+encodeURIComponent(task.id)+'/'+action,{
          method:'POST',body:JSON.stringify({requestId,...body}),signal,
        }) as Promise<{item:AgentTaskView}>);
      if (result.item?.id!==task.id) throw new Error(failure);
      accept(result.item);
    } catch (problem) {
      if (!isCurrent()) return;
      error = (problem as {status?:number})?.status===0 ? failure
        : problem instanceof Error ? problem.message : failure;
      // A timeout has already aborted the write signal. The read has its own deadline.
      controller = new AbortController();
      controlRequests.current.set(task.id,controller);
      try {
        const latest = await readCoworkTask(base,task.id,controller.signal);
        if (!isCurrent()) return;
        applyTaskUpdate(latest);
        if (confirmed(latest)) {
          controlKeys.delete(task.id);
          error = '';
          window.dispatchEvent(new Event('bambook:agent-task-update'));
        }
      } catch { /* The original operation remains available for an exact retry. */ }
    } finally {
      if (isCurrent()) {
        controlRequests.current.delete(task.id);
        setControls(old=>({...old,[task.id]:{busy:false,error}}));
      }
    }
  };
  const answer = (task:AgentTaskView,questionId:string,text:string) => {
    const answer = text.trim();
    return controlTask(task,'answer',{questionId,answer},item =>
      !!item.questions?.some(question=>question.id===questionId&&question.answeredAt&&question.answer===answer));
  };
  const cancel = (task:AgentTaskView) => controlTask(task,'cancel',{},item=>
    !COWORK_ACTIVE.includes(item.state)&&item.state!=='paused');
  const hasPendingSubmission = [...pending.current.values()].some(entry=>(entry.sourceConversationId??entry.conversationId)===visibleConversationId);
  const visibleControls={...controls};
  for(const task of tasks){
    const pending=controlKeys.get(task.id),previous=controls[task.id];
    const matching=pending&&pending.version===task.version&&!task.contentRestricted&&task.canControl!==false;
    if(previous?.error&&!matching)visibleControls[task.id]={...previous,error:''};
    if(!previous&&matching&&task.canControl)
      visibleControls[task.id]={busy:false,error:CONTROL_FAILURE[pending.action]};
  }
  return { available, tasks: tasks.filter(t => !t.automationId), all: tasks, loading, checkingAvailability, error, sendError, checkingReceipt, checkSubmission:()=>checkReceipts(false,visibleConversationId), controls:visibleControls, hasPendingSubmission, recoveredSubmissions, staleProgressIds, busy, send, refreshTask, answer, cancel, reload: load, loadMore, loadingMore, moreError, hasMore: !!more, applyTaskUpdate, track };
}
