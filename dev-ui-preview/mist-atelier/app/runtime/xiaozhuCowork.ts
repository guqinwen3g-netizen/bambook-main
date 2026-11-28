import {withRequestDeadline} from './requestDeadline';
import {answerFingerprint,answerRequestBody,saveTaskControls,type TaskControlIntent,type TaskControlRequest} from './xiaozhuControlRequests';
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
const BACKGROUND_PROGRESS_INTERVAL_MS = 3000;
const BACKGROUND_PROGRESS_MAX_IN_FLIGHT = 3;
const TASK_RETRY_INTERVAL_MS = 1000;
const TASK_RETRY_MAX_MS = 8000;
const REPORT_ACCESS_INTERVAL_MS = 10_000;

function restrictReport(task: AgentTaskView): AgentTaskView {
  return { ...task, contentRestricted: true, name: 'Agent任务', instructions: '', checkpoint: '', result: '',
    canControl: false, attachments: undefined, intentRefs: undefined, trail: undefined, questions: [],
    waitingProposalIds: [], resumeAt: null, waitingFor: null, nextCheckAt: null, requiredRead: null };
}

async function readSubmissionReceipt(base: string, entry: PendingSubmission, signal: AbortSignal): Promise<AgentTaskView> {
  const {item} = await mistApiRequest(base + '/personal-agent/tasks/receipt/' + encodeURIComponent(entry.requestId), {signal,cache:'no-store'}) as {item:AgentTaskView};
  if (!item?.id || item.executor !== 'platform' || item.conversationId !== entry.conversationId)
    throw new Error('提交结果暂时无法核对');
  return item;
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

async function readAttachmentAnswerReceipt(base:string,taskId:string,request:Extract<TaskControlRequest,{action:'answer'}>,controller:AbortController){
  const receipt=await withRequestDeadline(controller,HISTORY_READ_TIMEOUT_MS,CONTROL_FAILURE.answer,signal=>
    mistApiRequest(base+'/agent-tasks/'+encodeURIComponent(taskId)+'/answer/receipt/'+encodeURIComponent(request.requestId),{signal,cache:'no-store'})) as {item:AgentTaskView;attachmentIds:string[]};
  const question=receipt.item?.questions?.find(item=>item.id===request.questionId&&item.answeredAt);
  if(receipt.item?.id!==taskId||receipt.item.contentRestricted||!question||!Array.isArray(receipt.attachmentIds)
    ||!receipt.attachmentIds.length||!receipt.attachmentIds.every(id=>receipt.item.attachments?.some(file=>file.id===id)))
    throw Error(CONTROL_FAILURE.answer);
  return receipt.item;
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

type TaskReadFlight = { controller: AbortController; result: Promise<AgentTaskView>; readers: number };

/** Origin navigation and polling can cancel independently while sharing the same authorized in-flight read. */
function shareCoworkTaskRead(flights: Map<string, TaskReadFlight>, base: string, id: string, authority: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const key = JSON.stringify([authority, id]);
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const result = readCoworkTask(base, id, controller.signal).finally(() => {
      if (flights.get(key)?.controller === controller) flights.delete(key);
    });
    flight = { controller, result, readers: 0 };
    flights.set(key, flight);
  }
  const active = flight;
  active.readers++;
  return new Promise<AgentTaskView>((resolve, reject) => {
    let subscribed = true;
    const release = () => {
      if (!subscribed) return false;
      subscribed = false;
      signal.removeEventListener('abort', abort);
      active.readers--;
      if (active.readers === 0 && flights.get(key) === active) {
        flights.delete(key);
        active.controller.abort();
      }
      return true;
    };
    const abort = () => { if (release()) reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    active.result.then(
      item => { if (release()) resolve(item); },
      error => { if (release()) reject(error); },
    );
  });
}

function mergeTaskUpdate(previous: AgentTaskView, next: AgentTaskView): AgentTaskView {
  if (previous.id !== next.id || previous.identityId !== next.identityId || previous.executor !== next.executor
    || next.version < previous.version || next.updatedAt < previous.updatedAt) return previous;
  return previous.conversationId && !next.conversationId ? { ...next, conversationId: previous.conversationId } : next;
}

export type TaskControlState = { busy: boolean; error?: string; canCheckStop?: boolean; answerQuestionToCheck?: string; attachmentAnswerRecovered?:boolean };
const CONTROL_FAILURE={answer:'回答未确认，可重试',cancel:'停止结果未确认，可重试',resume:'继续结果未确认，可重试'};

export function useXiaozhuCowork(workspaceId: string | undefined, scope: string, enabled: boolean, visibleConversationId?: string, originTaskId?: string, savedControls?:Map<string,TaskControlRequest>, controlStorageScope?:string) {
  const base = workspaceId ? '/api/mist/workspaces/' + encodeURIComponent(workspaceId) : '';
  const [available, setAvailable] = React.useState(false), [cachedTasks, setTasks] = React.useState<AgentTaskView[]>([]);
  const [reportAccess, setReportAccess] = React.useState<{scope:string; restricted:Set<string>}>();
  const tasks = React.useMemo(() => cachedTasks.map(task => reportAccess?.scope === scope && reportAccess.restricted.has(task.id)
    ? restrictReport(task) : task), [cachedTasks, reportAccess, scope]);
  const restrictedReports = React.useRef(new Set<string>());
  const currentTasks = React.useRef(tasks);
  currentTasks.current = tasks;
  const [checkingAvailability, setCheckingAvailability] = React.useState(true);
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [more, setMore] = React.useState<string | undefined>(undefined);
  const [submission, setSubmission] = React.useState<{scope:string;conversationId?:string}>();
  const busy = submission?.scope === scope;
  const submittingHere = busy && (!visibleConversationId || submission.conversationId === visibleConversationId);
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
  const taskReads = React.useMemo(() => new Map<string, TaskReadFlight>(), [base, scope]);
  React.useEffect(() => () => {
    for (const flight of taskReads.values()) flight.controller.abort();
    taskReads.clear();
  }, [taskReads]);
  const version = React.useRef(0);
  const pending = React.useRef(new Map<string, PendingSubmission>());
  const [recoveredSubmissions, setRecoveredSubmissions] = React.useState<Array<PendingSubmission&{fingerprint:string}>>([]);
  const receiptRead = React.useRef<AbortController|undefined>(undefined);
  const receiptReconnectPending = React.useRef(false);
  const [checkingReceipt,setCheckingReceipt] = React.useState(false);
  const sendRequest = React.useRef<AbortController | undefined>(undefined);
  const controlRequests = React.useRef(new Map<string,AbortController>());
  const localControls=React.useMemo(()=>new Map<string,TaskControlRequest>(),[scope]);
  const controlKeys=savedControls??localControls;
  const restoredAnswerChecks=React.useMemo(()=>new Map<string,AbortController|null>(),[scope,base]);
  React.useEffect(()=>{
    let changed=false;
    for(const task of tasks){
      const pending=controlKeys.get(task.id);
      const restoredUpload=pending?.action==='answer'&&pending.hasAttachments&&pending.restoredFromStorage;
      if(pending&&(task.contentRestricted||!restoredUpload&&(task.version>pending.version||task.canControl===false))) {
        controlKeys.delete(task.id);
        changed=true;
      }
    }
    if(changed&&controlStorageScope)saveTaskControls(controlStorageScope,controlKeys);
  },[controlKeys,controlStorageScope,tasks]);
  const [controls,setControls] = React.useState<Record<string,TaskControlState>>({});
  const recoverRestoredAnswers=React.useCallback(()=>{
    if(!base||!enabled||!navigator.onLine)return;
    for(const task of currentTasks.current){
      const pending=controlKeys.get(task.id);
      if(pending?.action!=='answer'||!pending.hasAttachments||!pending.restoredFromStorage||task.contentRestricted
        ||!task.questions?.some(question=>question.id===pending.questionId&&question.answeredAt)
        ||restoredAnswerChecks.has(pending.requestId))continue;
      const controller=new AbortController();
      restoredAnswerChecks.set(pending.requestId,controller);
      const current=()=>live.current===scope&&restoredAnswerChecks.get(pending.requestId)===controller
        &&controlKeys.get(task.id)===pending&&currentTasks.current.some(item=>item.id===task.id&&!item.contentRestricted);
      const forget=()=>{
        controlKeys.delete(task.id);
        if(controlStorageScope)saveTaskControls(controlStorageScope,controlKeys);
      };
      void readAttachmentAnswerReceipt(base,task.id,pending,controller).then(item=>{
        if(!current())return;
        forget();
        setTasks(old=>old.map(previous=>mergeTaskUpdate(previous,item)));
        setControls(old=>({...old,[task.id]:{busy:false,attachmentAnswerRecovered:true}}));
      },error=>{
        // An answered question with no receipt for this request belongs to a different submission.
        if(current()&&(error as {status?:number})?.status===404)forget();
      }).finally(()=>{
        if(restoredAnswerChecks.get(pending.requestId)===controller)restoredAnswerChecks.set(pending.requestId,null);
      });
    }
  },[base,enabled,scope,controlKeys,controlStorageScope,restoredAnswerChecks]);
  React.useEffect(()=>{recoverRestoredAnswers();},[tasks,recoverRestoredAnswers]);
  React.useEffect(()=>{
    const reconnect=()=>{
      for(const [id,controller] of restoredAnswerChecks)if(!controller)restoredAnswerChecks.delete(id);
      recoverRestoredAnswers();
    };
    window.addEventListener('online',reconnect);
    return()=>{
      window.removeEventListener('online',reconnect);
      for(const controller of restoredAnswerChecks.values())controller?.abort();
      restoredAnswerChecks.clear();
    };
  },[recoverRestoredAnswers,restoredAnswerChecks]);
  const [sendFailure, setSendFailure] = React.useState<{conversationId?: string; message: string}>();
  const sendError = !visibleConversationId || sendFailure?.conversationId === visibleConversationId ? sendFailure?.message ?? '' : '';
  const historyRead = React.useRef<AbortController | undefined>(undefined);
  const capabilityRead = React.useRef<AbortController | undefined>(undefined);
  const moreRead = React.useRef<AbortController | undefined>(undefined);
  const [loadingMore, setLoadingMore] = React.useState(false), [moreError, setMoreError] = React.useState('');
  const personalIdentity = React.useRef<string | undefined>(undefined);
  const lastAvailability=React.useRef<{scope:string;available:boolean}|null>(null);
  const checkReceipts = React.useCallback(async function reconcileReceipts(mode: 'startup'|'manual'|'reconnect', conversation?: string) {
    if (!base || !enabled || live.current!==scope || (mode==='reconnect'&&!navigator.onLine)) return;
    if (receiptRead.current || sendRequest.current) {
      if (mode==='reconnect') receiptReconnectPending.current=true;
      return;
    }
    if (mode==='reconnect') receiptReconnectPending.current=false;
    const missing = [...pending.current].filter(([,entry]) => mode==='reconnect'
      || (mode==='startup' ? entry.recoveredFromStorage : (entry.sourceConversationId??entry.conversationId) === conversation));
    if (!missing.length) return;
    const controller = new AbortController();
    receiptRead.current=controller;setCheckingReceipt(true);
    const current=()=>live.current===scope&&receiptRead.current===controller;
    try {
      const replies = await withRequestDeadline(controller, HISTORY_READ_TIMEOUT_MS, '提交结果暂时无法核对', signal =>
        Promise.allSettled(missing.map(async ([fingerprint,entry]) => {
          const task = await readSubmissionReceipt(base,entry,signal);
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
      if (!current() || mode!=='manual') return;
      const unresolved=replies.filter((_,index)=>{
        const [fingerprint,entry]=missing[index];
        return pending.current.get(fingerprint)===entry;
      });
      if(unresolved.length)setSendFailure({conversationId:conversation,message:unresolved.every(reply=>reply.status==='rejected'&&reply.reason?.status===404)
        ?'暂未查到原提交回执':'提交结果暂时无法核对'});
    } catch {
      if (current()&&mode==='manual')setSendFailure({conversationId:conversation,message:'提交结果暂时无法核对'});
    } finally {
      if(current()){
        receiptRead.current=undefined;setCheckingReceipt(false);
        if(receiptReconnectPending.current)void reconcileReceipts('reconnect');
      }
    }
  },[base,enabled,scope]);
  React.useEffect(()=>{
    const reconnect=()=>{void checkReceipts('reconnect');};
    window.addEventListener('online',reconnect);
    return()=>window.removeEventListener('online',reconnect);
  },[checkReceipts]);
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
    const knownTaskIds = new Set(currentTasks.current.map(task => task.id));
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
      const listedTaskIds = new Set(visible.map(task => task.id));
      setTasks(old => {
        const previous = new Map(old.map(task => [task.id, task]));
        const history = visible.map(task => {
          const prior = previous.get(task.id);
          return prior ? mergeTaskUpdate(prior, task) : task;
        });
        // The page can omit an explicitly opened older task or a receipt recovered while it was in flight.
        const tracked = trackedOrigin.current;
        const originId = tracked?.scope === bound && tracked.id === origin.current ? tracked.id : undefined;
        const retained = old.filter(task => task.executor === 'platform' && (!own || task.identityId === own.id)
          && !listedTaskIds.has(task.id) && (task.id === originId || !knownTaskIds.has(task.id)));
        return retained.length ? [...history, ...retained].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : history;
      });
      setMore(page.cursor);
      setLoading(false);
      setError('');

      await checkReceipts('startup');
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
  React.useEffect(() => { restrictedReports.current = new Set(); setReportAccess(undefined); setTasks([]); setMore(undefined); setAvailable(false); setLoading(true);personalIdentity.current=undefined;lastAvailability.current=null; pending.current=readPendingSubmissions(scope); receiptReconnectPending.current=false; setRecoveredSubmissions([]); setCheckingReceipt(false); setControls({});  setSubmission(undefined); setSendFailure(undefined); void load(); return () => { version.current++; historyRead.current?.abort(); capabilityRead.current?.abort(); moreRead.current?.abort(); receiptRead.current?.abort(); receiptRead.current=undefined; sendRequest.current?.abort(); sendRequest.current=undefined; for(const controller of controlRequests.current.values())controller.abort(); controlRequests.current.clear(); }; }, [load,scope]);
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
    const restoreOrder = new Map<string, number>();
    let attempt = 0;
    let request: AbortController | undefined;
    const poll = async () => {
      if (request || !navigator.onLine || document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      request = controller;
      const current = () => request === controller && live.current === scope;
      const authority = deniedHistory.current;
      const authorized = () => current() && navigator.onLine && deniedHistory.current === authority;
      const readable = new Set<string>();
      let offset = 0;
      let denied = false;
      const maskReports = (ids: readonly string[]) => {
        const before = restrictedReports.current;
        const restricted = new Set([...before, ...ids]);
        if (restricted.size === before.size) return;
        restrictedReports.current = restricted;
        setReportAccess({ scope, restricted });
        setTasks(old => old.map(task => restricted.has(task.id) && !task.contentRestricted ? restrictReport(task) : task));
      };
      const checkBatches = async () => {
        while (authorized() && !denied && offset < ids.length) {
          const batch = ids.slice(offset, offset + TASK_ACCESS_BATCH_LIMIT);
          offset += TASK_ACCESS_BATCH_LIMIT;
          const batchController = new AbortController();
          const abort = () => batchController.abort(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once:true });
          try {
            const result = await withRequestDeadline(batchController, TASK_READ_TIMEOUT_MS, '任务暂时无法核对', signal =>
              mistApiRequest(base + '/personal-agent/task-access?taskIds=' + encodeURIComponent(batch.join(',')),
                { signal, cache:'no-store' }) as Promise<{ restrictedIds?: string[] }>);
            if (!authorized() || denied) return;
            if (!Array.isArray(result.restrictedIds) || result.restrictedIds.some(id => !batch.includes(id))) continue;
            for (const id of batch) if (!result.restrictedIds.includes(id)) readable.add(id);
            maskReports(result.restrictedIds);
          } catch (error) {
            if (!authorized()) return;
            if ([401, 403, 404].includes(Number((error as {status?:number})?.status))) {
              denied = true;
              readable.clear();
              maskReports(ids);
            }
          } finally {
            controller.signal.removeEventListener('abort', abort);
          }
        }
      };
      // A delayed batch must not postpone confirmed revocations from another batch.
      await Promise.all([checkBatches(), checkBatches()]);
      if (!authorized() || denied) {
        if (current()) request = undefined;
        return;
      }
      // Restore each report only after its own fresh, authorized full read.
      const toRestore = currentTasks.current.filter(task => readable.has(task.id) && task.contentRestricted)
        .sort((left,right) => (restoreOrder.get(left.id) ?? 0) - (restoreOrder.get(right.id) ?? 0))
        .slice(0, 4);
      await Promise.allSettled(toRestore.map(async task => {
        restoreOrder.set(task.id, ++attempt);
        const next = await readCoworkTask(base, task.id, controller.signal);
        if (!authorized() || next.contentRestricted) return;
        const previous = currentTasks.current.find(item => item.id === task.id);
        if (!previous?.contentRestricted || mergeTaskUpdate(previous, next) === previous) return;
        const remaining = new Set(restrictedReports.current);
        if (!remaining.delete(task.id)) return;
        restrictedReports.current = remaining;
        setTasks(old => old.map(item => mergeTaskUpdate(item, next)));
        setReportAccess({ scope, restricted: remaining });
      }));
      if (!current()) return;
      request = undefined;
    };
    const suspend = () => {
      const previous = request;
      request = undefined;
      previous?.abort();
    };
    const wake = () => void poll();
    const timer = window.setInterval(wake, REPORT_ACCESS_INTERVAL_MS);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', suspend);
    wake();
    return () => {
      suspend();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', suspend);
    };
  }, [base, enabled, openReportIds, scope]);
  const visiblePausedIds = visibleConversationId ? tasks.filter(task => task.state === 'paused'
    && (task.conversationId || 'legacy_' + task.id) === visibleConversationId)
    .slice(-BACKGROUND_PROGRESS_MAX_IN_FLIGHT).map(task => task.id).join(',') : '';
  React.useEffect(() => {
    if (!base || !enabled || !visiblePausedIds) return;
    let request: AbortController | undefined;
    const suspend = () => {
      const previous = request;
      request = undefined;
      previous?.abort();
    };
    const wake = async () => {
      if (request || live.current !== scope || !navigator.onLine || document.visibilityState === 'hidden') return;
      const controller = new AbortController(), denial = deniedHistory.current;
      request = controller;
      const replies = await Promise.allSettled(visiblePausedIds.split(',').map(id =>
        shareCoworkTaskRead(taskReads, base, id, denial, controller.signal)));
      if (request !== controller) return;
      request = undefined;
      if (live.current !== scope || deniedHistory.current !== denial) return;
      const updates = new Map(replies.flatMap(reply => reply.status === 'fulfilled' ? [[reply.value.id, reply.value] as const] : []));
      if (updates.size) setTasks(previous => previous.map(task => {
        const next = updates.get(task.id);
        return next ? mergeTaskUpdate(task, next) : task;
      }));
    };
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', suspend);
    document.addEventListener('visibilitychange', wake);
    return () => {
      suspend();
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', suspend);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [base, enabled, scope, taskReads, visiblePausedIds]);
  const activeTasks = tasks.filter(t => COWORK_ACTIVE.includes(t.state));
  const foregroundId = activeTasks.filter(t => visibleConversationId && t.conversationId === visibleConversationId
    && (t.state === 'running' || t.state === 'queued')).at(-1)?.id;
  const staleProgressIds = staleProgress?.scope === scope ? staleProgress.ids : undefined;
  const backgroundIds = activeTasks.filter(t => t.id !== foregroundId).map(t => t.id).join(',');
  const hasProgressTargets = activeTasks.length > 0;
  const progressTargets = React.useRef({ foregroundId, background: [] as string[] });
  progressTargets.current = { foregroundId, background: backgroundIds ? backgroundIds.split(',') : [] };
  const syncProgressTargets = React.useRef<(() => void) | undefined>(undefined);
  const manualProgressRead = React.useRef<((taskId:string)=>Promise<void>|undefined)|undefined>(undefined);
  const recheckProgress = React.useCallback(async(taskId:string)=>{ await manualProgressRead.current?.(taskId); },[]);

  React.useEffect(() => {
    if (!hasProgressTargets || !base || !enabled) return;
    const inFlight = new Map<string, {controller:AbortController;promise:Promise<void>}>();
    const retry = new Map<string, { delay: number; at: number }>();
    const backgroundAt = new Map<string, number>();
    const markStale = (ids: string[]) => setStaleProgress(old => {
      const previous = old?.scope === scope ? old.ids : undefined;
      if (previous && ids.every(id => previous.has(id))) return old;
      return { scope, ids: new Set([...(previous ?? []), ...ids]) };
    });
    const readProgress=(id:string)=>{
      const pending=inFlight.get(id);
      if(pending)return pending.promise;
      const controller=new AbortController(), denial=deniedHistory.current;
      backgroundAt.set(id,Date.now()+BACKGROUND_PROGRESS_INTERVAL_MS);
      const promise=shareCoworkTaskRead(taskReads,base,id,denial,controller.signal)
        .then(next=>{
          if(controller.signal.aborted||live.current!==scope||deniedHistory.current!==denial)return;
          retry.delete(id);
          setTasks(old=>old.map(task=>mergeTaskUpdate(task,next)));
          clearStaleProgress(id);
        })
        .catch(()=>{
          if(controller.signal.aborted||live.current!==scope)return;
          const previous=retry.get(id);
          const delay=previous?Math.min(TASK_RETRY_MAX_MS,previous.delay*2):TASK_RETRY_INTERVAL_MS;
          retry.set(id,{delay,at:Date.now()+delay});
          markStale([id]);
        })
        .finally(()=>{
          if(inFlight.get(id)?.controller!==controller)return;
          inFlight.delete(id);
          if(!controller.signal.aborted)fillBackground();
        });
      inFlight.set(id,{controller,promise});
      return promise;
    };
    const manual=(id:string)=>{
      const {foregroundId,background}=progressTargets.current;
      if(live.current!==scope||!navigator.onLine||(id!==foregroundId&&!background.includes(id)))return;
      return readProgress(id);
    };
    const abortReads = () => {
      for(const {controller} of inFlight.values())controller.abort();
      inFlight.clear();
    };
    manualProgressRead.current=manual;
    const canPoll = () => live.current === scope && navigator.onLine && document.visibilityState !== 'hidden';
    const isDue = (id:string,now:number) => !inFlight.has(id) && now >= (retry.get(id)?.at ?? 0);
    function fillBackground() {
      if (!canPoll()) return;
      const {background,foregroundId} = progressTargets.current;
      const backgroundInFlight = inFlight.size - (foregroundId && inFlight.has(foregroundId) ? 1 : 0);
      const slots = BACKGROUND_PROGRESS_MAX_IN_FLIGHT - backgroundInFlight;
      if (slots <= 0) return;
      const now = Date.now();
      const dueAt = (id:string) => backgroundAt.get(id) ?? 0;
      // Unread and oldest tasks get the next freed slots before recently updated tasks.
      const ready = background.filter(id => dueAt(id) <= now && isDue(id,now)).sort((left,right) => dueAt(left) - dueAt(right));
      for (const id of ready.slice(0,slots)) void readProgress(id);
    }
    const poll = () => {
      // An existing task may finish or pause while new model execution is unavailable.
      if (!canPoll()) return;
      const {foregroundId} = progressTargets.current;
      if (foregroundId && isDue(foregroundId,Date.now())) void readProgress(foregroundId);
      fillBackground();
    };
    const offline = () => {
      abortReads();
      const {foregroundId,background}=progressTargets.current;
      markStale(foregroundId ? [foregroundId,...background] : background);
    };
    const sync = () => {
      const {foregroundId,background}=progressTargets.current;
      const active=new Set(background);
      if(foregroundId)active.add(foregroundId);
      // One finished task must not cancel reads or clear the backoff for other active tasks.
      for(const [id,pending] of inFlight)if(!active.has(id)){
        pending.controller.abort();
        inFlight.delete(id);
      }
      for(const id of retry.keys())if(!active.has(id))retry.delete(id);
      for(const id of backgroundAt.keys())if(!active.has(id))backgroundAt.delete(id);
      if(navigator.onLine)poll();
      else offline();
    };
    syncProgressTargets.current=sync;
    const refreshVisible = () => {
      if (document.visibilityState === 'hidden') {
        abortReads();
        return;
      }
      retry.clear();
      backgroundAt.clear();
      poll();
    };
    const timer = window.setInterval(poll, 1000);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('offline', offline);
    window.addEventListener('online', refreshVisible);
    return () => {
      if(manualProgressRead.current===manual)manualProgressRead.current=undefined;
      if(syncProgressTargets.current===sync)syncProgressTargets.current=undefined;
      abortReads();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', refreshVisible);
    };
  }, [hasProgressTargets, base, enabled, scope, clearStaleProgress, taskReads]);
  React.useEffect(() => {
    syncProgressTargets.current?.();
  }, [foregroundId, backgroundIds, base, enabled, scope]);
  const send = async (text: string, history: AgentTaskView[] = [], conversationId?: string, intentRefs:AgentTaskIntentRef[]=[], files:File[]=[], attachmentRefs:ReadonlyArray<TaskAttachmentRef>=[]): Promise<AgentTaskView | null> => {
    const message = text.trim();
    if (!message || sendRequest.current || receiptRead.current || !base || loading || checkingAvailability || error || !available) return null;
    const bound = scope, controller = new AbortController();
    sendRequest.current = controller;
    const isCurrent = () => live.current === bound && sendRequest.current === controller;
    setSubmission({scope:bound,conversationId:visibleConversationId??conversationId});
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
      let result: {item:AgentTaskView} | undefined;
      if (saved && files.length) {
        const original = saved;
        try {
          const item = await withRequestDeadline(controller,HISTORY_READ_TIMEOUT_MS,'提交结果暂时无法核对',
            signal => readSubmissionReceipt(base,original,signal));
          result = {item};
        } catch (problem) {
          // Only a missing receipt should resend the original multipart request.
          if ((problem as {status?:number})?.status !== 404) throw problem;
        }
        if (!isCurrent() || controller.signal.aborted) return null;
      }
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
      if (!result) {
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
        result = await withRequestDeadline(controller, TASK_SEND_TIMEOUT_MS + uploadSeconds * 1000, '提交结果待核对', signal =>
          mistApiRequest(base + '/personal-agent/tasks', { ...submission, signal }) as Promise<{item: AgentTaskView}>);
      }
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
        setSubmission(undefined);
        if(receiptReconnectPending.current)void checkReceipts('reconnect');
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
    const previous = currentTasks.current.find(task => task.id === taskId);
    const joinProgress = retainOrigin && (!previous || !previous.contentRestricted && COWORK_ACTIVE.includes(previous.state));
    const item = await (joinProgress ? shareCoworkTaskRead(taskReads, base, taskId, denial, signal) : readCoworkTask(base, taskId, signal));
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
  const controlTask = async (task:AgentTaskView, intent:TaskControlIntent|TaskControlRequest) => {
    if (!base || !enabled || controlRequests.current.has(task.id)) return;
    const {action}=intent;
    const checkOnly='requestId' in intent;
    if(checkOnly&&(intent.version!==task.version||task.contentRestricted||!task.canControl))return;
    const failure = CONTROL_FAILURE[action];
    let controller = new AbortController();
    const isCurrent = () => live.current===scope && controlRequests.current.get(task.id)===controller;
    controlRequests.current.set(task.id,controller);
    setControls(old=>({...old,[task.id]:{busy:true,...(checkOnly?{error:failure}:{})}}));

    let submitted:TaskControlRequest|undefined=checkOnly?intent:undefined;
    let error = '';
    const accept = (item:AgentTaskView) => {
      if (!isCurrent()) return;
      applyTaskUpdate(item);
      controlKeys.delete(task.id);
      if(controlStorageScope)saveTaskControls(controlStorageScope,controlKeys);
      window.dispatchEvent(new Event('bambook:agent-task-update'));
    };
    const checkTask = async (request:TaskControlRequest) => {
      const denial = deniedHistory.current;
      if(request.action==='answer'&&request.hasAttachments){
        try{
          const item=await readAttachmentAnswerReceipt(base,task.id,request,controller);
          if(!isCurrent()||deniedHistory.current!==denial)return;
          clearStaleProgress(task.id);
          accept(item);
          error='';
          return;
        }catch(problem){
          if((problem as {status?:number})?.status!==404)throw problem;
        }
      }
      const latest = await readCoworkTask(base,task.id,controller.signal);
      const answer=request.action==='answer'
        ? latest.questions?.find(question=>question.id===request.questionId&&question.answeredAt)?.answer : undefined;
      const confirmed = request.action==='answer'
        ? !request.hasAttachments&&answer!==undefined&&(request.answer!==undefined
          ? answer===request.answer : !!request.fingerprint&&await answerFingerprint(task.id,request.questionId,answer)===request.fingerprint)
        : request.action==='resume' ? latest.version>request.version&&latest.state!=='paused'
        : !COWORK_ACTIVE.includes(latest.state)&&latest.state!=='paused';
      if (!isCurrent() || deniedHistory.current!==denial) return;
      clearStaleProgress(task.id);
      if (confirmed) {
        accept(latest);
        error = '';
      } else applyTaskUpdate(latest);
    };
    try {
      if (checkOnly) {
        error = failure;
        await checkTask(intent);
        return;
      }
      const existing=controlKeys.get(task.id);
      const files=intent.action==='answer'?intent.files??[]:[];
      const hasAttachments=files.length>0;
      const fingerprint=intent.action==='answer'?await answerFingerprint(task.id,intent.questionId,intent.answer,files):undefined;
      if(!isCurrent())return;
      if(hasAttachments&&!fingerprint)throw Error('附件无法核对，请重新选择后再试');
      const same=existing?.version===task.version&&(intent.action!=='answer'?existing.action===intent.action
        : existing.action==='answer'&&existing.questionId===intent.questionId
          &&!!existing.hasAttachments===hasAttachments
          &&(!hasAttachments&&existing.answer===intent.answer||!!fingerprint&&existing.fingerprint===fingerprint));
      const requestId=same?existing.requestId:crypto.randomUUID();
      submitted=intent.action==='answer'
        ? {action:'answer',questionId:intent.questionId,answer:intent.answer,requestId,version:task.version,fingerprint,...(hasAttachments?{hasAttachments:true}:{})}
        : {...intent,requestId,version:task.version};
      controlKeys.set(task.id,submitted);
      if(controlStorageScope)saveTaskControls(controlStorageScope,controlKeys);
      const payload={requestId,version:task.version};
      const body=intent.action==='answer'?answerRequestBody({...payload,questionId:intent.questionId,answer:intent.answer},files):JSON.stringify(payload);
      const timeout=hasAttachments?TASK_SEND_TIMEOUT_MS+Math.ceil(files.reduce((bytes,file)=>bytes+file.size,0)/UPLOAD_BYTES_PER_SECOND)*1000:HISTORY_READ_TIMEOUT_MS;
      const result = await withRequestDeadline(controller,timeout,failure,signal =>
        mistApiRequest(base+'/agent-tasks/'+encodeURIComponent(task.id)+'/'+action,{
          method:'POST',body,signal,
        }) as Promise<{item:AgentTaskView}>);
      if (result.item?.id!==task.id) throw new Error(failure);
      accept(result.item);
    } catch (problem) {
      if (!isCurrent() || checkOnly) return;
      error = (problem as {status?:number})?.status===0 ? failure
        : problem instanceof Error ? problem.message : failure;
      controller = new AbortController();
      controlRequests.current.set(task.id,controller);
      try { if(submitted)await checkTask(submitted); }
      catch { /* The original operation remains available for an exact retry. */ }
    } finally {
      if (isCurrent()) {
        controlRequests.current.delete(task.id);
        setControls(old=>({...old,[task.id]:{busy:false,error}}));
      }
    }
  };
  const answer = (task:AgentTaskView,questionId:string,text:string,files?:readonly File[]) =>
    controlTask(task,{action:'answer',questionId,answer:text.trim(),files});
  const checkAnswer = (task:AgentTaskView,questionId:string) => {
    const submitted=controlKeys.get(task.id);
    if (submitted?.action==='answer'&&submitted.questionId===questionId)return controlTask(task,submitted);
  };
  const cancel = (task:AgentTaskView) => controlTask(task,{action:'cancel'});
  const resume = (task:AgentTaskView) => {
    if(available&&task.state==='paused'&&task.canControl)return controlTask(task,{action:'resume'});
  };
  const checkStop = (task:AgentTaskView) => {
    const submitted=controlKeys.get(task.id);
    if(submitted?.action==='cancel')return controlTask(task,submitted);
  };
  const hasPendingSubmission = [...pending.current.values()].some(entry=>(entry.sourceConversationId??entry.conversationId)===visibleConversationId);
  const visibleControls={...controls};
  for(const task of tasks){
    const pending=controlKeys.get(task.id),previous=controls[task.id];
    const matching=pending&&pending.version===task.version&&!task.contentRestricted&&task.canControl!==false;
    if(previous?.error&&!matching)visibleControls[task.id]={...previous,error:''};
    if(!previous&&matching&&task.canControl)
      visibleControls[task.id]={busy:false,error:CONTROL_FAILURE[pending.action]};
    if(matching&&pending.action!=='resume'&&visibleControls[task.id]?.error) {
      visibleControls[task.id]={...visibleControls[task.id],...(pending.action==='cancel'
        ? {canCheckStop:true} : pending.action==='answer' ? {answerQuestionToCheck:pending.questionId} : {})};
    }
  }
  return { available, tasks: tasks.filter(t => !t.automationId), all: tasks, loading, checkingAvailability, error, sendError, checkingReceipt, checkSubmission:()=>checkReceipts('manual',visibleConversationId), controls:visibleControls, hasPendingSubmission, recoveredSubmissions, staleProgressIds, busy, submittingHere, send, refreshTask, answer, checkAnswer, cancel, checkStop, resume, recheckProgress, reload: load, loadMore, loadingMore, moreError, hasMore: !!more, applyTaskUpdate, track };
}
