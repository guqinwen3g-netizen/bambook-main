import {agentSource} from '../runtime/agentSource';
import {XiaozhuMarkdown} from './modules/XiaozhuMarkdown';
import {XiaozhuPhaseTimer} from './modules/XiaozhuPhaseTimer';
import React from 'react';
import { Bot, Copy, Plus, RefreshCw } from 'lucide-react';
import { Banner, Button, Card, CardBody, CardHeader, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, Pill, Select, Skeleton, TextArea, TextInput, useToast, type Column, type Tone } from '../../../../components/mist';
import type { AgentTaskEvent, AgentTaskPage, AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import type { AgentIdentityView } from '../../../../server/src/shared/mistAgentIdentities';
import { uiText, interfaceLocale } from '../../../../services/interfaceLanguage';
import { mistApiRequest, useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { useNav } from '../nav';
import { agentConnectionEndpoint } from './AgentConnections';
import { FailureNotice } from '../runtime/FailureNotice';
import { withRequestDeadline } from '../runtime/requestDeadline';
import { activeModelFallbackSince } from '../runtime/xiaozhuActivity';

const LABEL:Record<AgentTaskView['state'],string>={queued:'待领取',running:'执行中',waiting_time:'等待继续',waiting_condition:'等待资料变化',waiting_human:'待本人确认',paused:'已暂停',succeeded:'执行结束',failed:'执行失败',cancelled:'已停止',expired:'已到期',budget_exhausted:'达到限额',access_changed:'权限已变化'};
const ACTION:Record<string,string>={created:'安排任务',connected:'签发任务连接',claimed:'执行器领取',checkpoint:'保存检查点',waiting_human:'等待本人确认',question:'请求补充资料',waiting_time:'等待约定时间',waiting_condition:'等待资料变化',condition_changed:'资料已变化',condition_deadline:'到达最晚时间',answered:'本人补充资料',model_retry:'模型重试',model_paused:'模型已暂停',recovering:'等待接续',confirmed:'本人确认',rejected:'本人拒绝',pause:'暂停任务',resume:'继续任务',cancel:'停止任务',finished:'执行结束'};
const TASK_REFRESH_MS=10_000, CONNECTION_REFRESH_MS=60_000;
const livePlatformTask=(row:AgentTaskView)=>row.executor==='platform'&&(row.state==='running'||row.state==='queued');
const statusLabel=(row:AgentTaskView,progressUnavailable=false)=>{
 if(row.runnerStatus==='heartbeat_stale'||(progressUnavailable&&livePlatformTask(row)))return '执行进度暂未更新';
 if(row.runnerStatus==='awaiting_reclaim')return '待重新领取';
 if(row.state==='waiting_human'&&row.questions?.some(q=>!q.answeredAt))return '待补充资料';
 if(row.state==='queued'&&row.executionIssue)return row.executionIssue.retryAt?'等待模型重试':'等待重试';
 if(row.state==='queued'&&row.executor==='platform')return '待执行';
 if(row.state==='queued'&&row.lastHeartbeatAt)return '待重新领取';
 if(row.state==='running'&&row.executionStage==='model')return activeModelFallbackSince(row)?'正在等待备用模型':'正在等待模型';
 return LABEL[row.state];
};
const contentRestricted=(row:AgentTaskView)=>'contentRestricted' in row&&row.contentRestricted===true;
const accessDenied=(error:unknown)=>[401,403,404].includes(Number((error as {status?:number})?.status));
const tone=(state:AgentTaskView['state']):Tone=>state==='running'?'accent':state==='succeeded'?'ok':['waiting_human','expired','budget_exhausted'].includes(state)?'warn':['failed','access_changed'].includes(state)?'bad':'neutral';
const time=(v:string|null)=>v?new Date(v).toLocaleString(interfaceLocale(),{timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const duration=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
type Plan={kind:'create';requestId:string;identityId:string;name:string;instructions:string;executor:'external'|'platform'}|{kind:'answer';requestId:string;row:AgentTaskView;questionId:string;answer:string}|{kind:'pause'|'resume'|'cancel'|'issue';requestId:string;row:AgentTaskView};
async function readTaskPages(base:string,initialCursor:string|null,limit:number,signal:AbortSignal) {
 const items=new Map<string,AgentTaskView>(),seen=new Set<string>();
 let nextCursor=initialCursor,pages=0;
 do{
  signal.throwIfAborted();
  if(nextCursor)seen.add(nextCursor);
  const result=await mistApiRequest(base+(nextCursor?'?cursor='+encodeURIComponent(nextCursor):''),{signal}) as AgentTaskPage;
  if(!Array.isArray(result.items))throw new Error('任务响应无效');
  nextCursor=result.nextCursor??null;
  if(nextCursor!==null&&(typeof nextCursor!=='string'||!nextCursor||seen.has(nextCursor)))throw new Error('任务翻页响应无效');
  for(const item of result.items)items.set(item.id,item);
  pages++;
 }while(nextCursor&&pages<limit);
 return {items:[...items.values()],nextCursor,pages};
}
type TaskPanelProps = {
  onConnections: () => void;
  rowAction?: (row: AgentTaskView) => React.ReactNode;
  refreshSignal?: number;
  onTaskUpdate?: (item: AgentTaskView) => void;
};
export function AgentTasks(props:TaskPanelProps){
 const w=useMistWorkspace(),s=useMistSession();
 return w.workspace?<TaskPanel key={JSON.stringify([s.sessionKey,s.user?.id,w.workspace.id])} workspaceId={w.workspace.id} {...props}/>:<EmptyState title={uiText('尚未进入公司')}/>;
}
function TaskPanel({workspaceId,onConnections,rowAction,refreshSignal,onTaskUpdate}:TaskPanelProps&{workspaceId:string}){
 const w=useMistWorkspace(),nav=useNav(),toast=useToast(),base='/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-tasks',endpoint=agentConnectionEndpoint(location.origin);
 const [platformAvailable,setPlatformAvailable]=React.useState(false);
 const [page,setPage]=React.useState<AgentTaskPage>({items:[],nextCursor:null}),[identities,setIdentities]=React.useState<AgentIdentityView[]>([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
 const [loadingMore,setLoadingMore]=React.useState(false);
 const [plan,setPlan]=React.useState<Plan|null>(null),[busy,setBusy]=React.useState(false),[failure,setFailure]=React.useState(''),[uncertain,setUncertain]=React.useState(false),[credential,setCredential]=React.useState<{item:AgentTaskView;token:string}|null>(null);
 const [detail,setDetail]=React.useState<AgentTaskView|null>(null),[history,setHistory]=React.useState<{items:AgentTaskEvent[];nextCursor:string|null}>({items:[],nextCursor:null}),[detailError,setDetailError]=React.useState('');
 const [detailTarget,setDetailTarget]=React.useState<string|null>(null),[opening,setOpening]=React.useState(false);
 const [historyLoading,setHistoryLoading]=React.useState(false),[historyError,setHistoryError]=React.useState('');
 const [detailNeedsRead,setDetailNeedsRead]=React.useState(false);
 const detailRef=React.useRef<AgentTaskView|null>(null);
 const setCurrentDetail=(item:AgentTaskView|null)=>{detailRef.current=item;setDetail(item);};
 const onTaskUpdateRef=React.useRef(onTaskUpdate);onTaskUpdateRef.current=onTaskUpdate;
 const alive=React.useRef(false),readGeneration=React.useRef(0),writeGeneration=React.useRef(0),detailGeneration=React.useRef(0),readAbort=React.useRef<AbortController|null>(null),writeAbort=React.useRef<AbortController|null>(null);
 const listAbort=React.useRef<AbortController|null>(null);
 const connectionReadAt=React.useRef<number|undefined>(undefined);
 const loadedPages=React.useRef(1);
 const [connectionError,setConnectionError]=React.useState('');
 const detailAbort=React.useRef<AbortController|null>(null),historyAbort=React.useRef<AbortController|null>(null);
 const readDetail=React.useCallback(async(id:string,opening=false)=>{
  if(detailAbort.current&&!opening)return;
  const epoch=detailGeneration.current,abort=new AbortController();detailAbort.current=abort;
  const current=()=>alive.current&&epoch===detailGeneration.current&&detailAbort.current===abort;
  const clearDetailActions=()=>{
   setPlan(plan=>plan&&'row' in plan&&plan.row.id===id?null:plan);
   setCredential(credential=>credential?.item.id===id?null:credential);
  };
  try{
   const result=await withRequestDeadline(abort,8_000,'任务详情读取超时',signal=>
    mistApiRequest(base+'/'+encodeURIComponent(id),{signal,cache:'no-store'}));
   if(result.item?.id!==id)throw new Error('任务详情响应无效');
   if(!current())return;
   const item:AgentTaskView=result.item;
   const previous=detailRef.current;
   if(previous?.id===id&&item.version<previous.version)return;
   if(contentRestricted(item))clearDetailActions();
   setCurrentDetail(item);setDetailError('');setDetailNeedsRead(false);
   setPage(page=>({...page,items:page.items.map(row=>row.id===id&&row.version<=item.version?item:row)}));
   if(!previous||previous.id!==id||previous.version!==item.version||previous.updatedAt!==item.updatedAt
    ||contentRestricted(previous)!==contentRestricted(item))onTaskUpdateRef.current?.(item);
  }catch(error){
   if(!current())return;
   if(accessDenied(error)){
    setCurrentDetail(null);clearDetailActions();
    setPage(page=>({...page,items:page.items.filter(row=>row.id!==id)}));
   }
   setDetailError(error instanceof Error?error.message:'任务详情读取失败');
  }finally{
   if(current()){detailAbort.current=null;if(opening)setOpening(false);}
  }
 },[base]);
 const load=React.useCallback(async(append=false,refreshConnections=true)=>{
  if(append&&(listAbort.current||!page.nextCursor))return;
  const epoch=++readGeneration.current;
  readAbort.current?.abort();listAbort.current?.abort();
  const auxiliary=new AbortController(),listing=new AbortController();
  const readConnectionSettings=refreshConnections||connectionReadAt.current===undefined
   ||Date.now()-connectionReadAt.current>=CONNECTION_REFRESH_MS;
  if(readConnectionSettings)connectionReadAt.current=undefined;
  readAbort.current=auxiliary;listAbort.current=listing;setError('');setLoadingMore(append);
  const selectedSnapshot=detailRef.current,selected=selectedSnapshot?.id,selectedGeneration=detailGeneration.current;
  let denied=false;
  const current=()=>alive.current&&epoch===readGeneration.current;
  const detailIsCurrent=()=>current()&&selectedGeneration===detailGeneration.current&&detailRef.current?.id===selected;
  const deny=(error:unknown)=>{
   if(!accessDenied(error))return false;
   denied=true;connectionReadAt.current=undefined;loadedPages.current=1;
   auxiliary.abort();listing.abort();detailGeneration.current++;
   detailAbort.current?.abort();historyAbort.current?.abort();
   setPage({items:[],nextCursor:null});setCurrentDetail(null);setDetailTarget(null);setOpening(false);setPlan(null);setCredential(null);
   setIdentities([]);setPlatformAvailable(false);setError(error instanceof Error?error.message:'任务读取失败');
   return true;
  };
  const listRead=withRequestDeadline(listing,8_000,'任务列表读取超时',signal=>
   readTaskPages(base,append?page.nextCursor:null,append?1:loadedPages.current,signal))
   .then(result=>{
    if(!current()||listing.signal.aborted)return;
    // An overlapping detail read may have applied a newer access projection at the same task version.
    const latest=detailRef.current;
    const detailAdvanced=latest!==selectedSnapshot&&selectedGeneration===detailGeneration.current;
    const items=result.items.flatMap(row=>{
     if(!detailAdvanced||row.id!==selected)return [row];
     if(latest?.id===selected&&latest.version>=row.version)return [latest];
     return latest===null?[]:[row];
    });
    loadedPages.current=append?loadedPages.current+result.pages:result.pages;
    const nextCursor=result.nextCursor;
    setPage(previous=>({nextCursor,items:append
     ? [...new Map([...previous.items,...items].map(row=>[row.id,row])).values()]
     : items}));
   }).catch(error=>{if(current()&&!denied&&!deny(error))setError(error instanceof Error?error.message:'任务读取失败');})
   .finally(()=>{
    if(!current())return;
    listAbort.current=null;setLoading(false);setLoadingMore(false);
   });
  let connectionsPending=readConnectionSettings,capabilitiesPending=readConnectionSettings,metadataReads=0;
  const auxiliaryCurrent=()=>current()&&!auxiliary.signal.aborted;
  const confirmMetadata=()=>{if(++metadataReads===2)connectionReadAt.current=Date.now();};
  const readConnections=async(signal:AbortSignal)=>{
   const items:AgentIdentityView[]=[],seen=new Set<string>();let cursor:string|null=null;
   do{
    const result=await mistApiRequest('/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-identities?scope=mine'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal});
    signal.throwIfAborted();
    if(!Array.isArray(result.items))throw new Error('连接响应无效');
    items.push(...result.items);cursor=result.nextCursor??null;
    if(cursor&&seen.has(cursor))throw new Error('连接响应无效');if(cursor)seen.add(cursor);
   }while(cursor);
   return items;
  };
  const auxiliaryRead=withRequestDeadline(auxiliary,8_000,'任务辅助请求超时',signal=>Promise.allSettled([
   readConnectionSettings?readConnections(signal).then(items=>{
    if(auxiliaryCurrent()){setIdentities(items);setConnectionError('');confirmMetadata();}
   }).catch(error=>{
    if(auxiliaryCurrent()&&!deny(error)){setIdentities([]);setConnectionError(error instanceof Error?error.message:'连接读取失败');}
   }).finally(()=>{connectionsPending=false;}):null,
   readConnectionSettings?mistApiRequest('/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-task-capabilities',{signal})
    .then(result=>{
     if(!auxiliaryCurrent())return;
     if(typeof result.platformAvailable!=='boolean')throw new Error('任务执行能力响应无效');
     setPlatformAvailable(result.platformAvailable);confirmMetadata();
    })
    .catch(()=>{if(auxiliaryCurrent())setPlatformAvailable(false);}).finally(()=>{capabilitiesPending=false;}):null,
   selected&&!historyAbort.current?mistApiRequest(base+'/'+encodeURIComponent(selected)+'/history',{signal}).then(events=>{
    if(!auxiliaryCurrent()||!detailIsCurrent()||!Array.isArray(events.items))return;
    setHistory(previous=>{const fresh=events.items as AgentTaskEvent[];return{items:[...fresh,...previous.items.filter(old=>!fresh.some(event=>event.version===old.version&&event.action===old.action))],nextCursor:previous.items.length>30?previous.nextCursor:events.nextCursor};});
    setHistoryError('');
   }).catch(error=>{if(auxiliaryCurrent()&&detailIsCurrent()&&!deny(error))setHistoryError(error instanceof Error?error.message:'任务记录读取失败');}):null,
  ])).catch(()=>{
   if(!current()||denied)return;
   if(connectionsPending){setIdentities([]);setConnectionError('连接读取超时');}
   if(capabilitiesPending)setPlatformAvailable(false);
  });
  await Promise.all([listRead,auxiliaryRead,selected?readDetail(selected):null]);
 },[base,workspaceId,page.nextCursor,readDetail]);
 const currentLoad=React.useRef(load);currentLoad.current=load;
 React.useEffect(()=>{
  alive.current=true;connectionReadAt.current=undefined;
  const wake=()=>{if(!document.hidden&&navigator.onLine)void currentLoad.current();};
  wake();
  const timer=window.setInterval(()=>{
   if(!document.hidden&&navigator.onLine&&!listAbort.current)void currentLoad.current(false,false);
  },TASK_REFRESH_MS);
  window.addEventListener('online',wake);
  document.addEventListener('visibilitychange',wake);
  return()=>{
   alive.current=false;readGeneration.current++;writeGeneration.current++;detailGeneration.current++;
   window.clearInterval(timer);
   window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);
   readAbort.current?.abort();listAbort.current?.abort();writeAbort.current?.abort();detailAbort.current?.abort();historyAbort.current?.abort();
  };
 },[base]);
 const watchingDetail=!!detail&&livePlatformTask(detail);
 React.useEffect(()=>{
  if(!detailTarget)return;
  const wake=()=>{if(!document.hidden&&navigator.onLine)void readDetail(detailTarget);};
  const offline=()=>{
   if(!watchingDetail)return;
   detailAbort.current?.abort();detailAbort.current=null;
   setDetailNeedsRead(true);
  };
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  window.addEventListener('online',wake);window.addEventListener('offline',offline);
  const timer=watchingDetail?window.setInterval(wake,2500):undefined;
  return()=>{
   window.clearInterval(timer);
   window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);
   window.removeEventListener('online',wake);window.removeEventListener('offline',offline);
  };
 },[detailTarget,readDetail,watchingDetail]);
 const readDetailHistory=async(id:string,cursor?:string|null)=>{
  const epoch=detailGeneration.current, abort=new AbortController();
  historyAbort.current?.abort();historyAbort.current=abort;setHistoryLoading(true);setHistoryError('');
  const current=()=>alive.current&&epoch===detailGeneration.current&&historyAbort.current===abort;
  try{
   const suffix=cursor?'?cursor='+encodeURIComponent(cursor):'';
   const events=await withRequestDeadline(abort,8_000,'任务记录读取超时',signal=>mistApiRequest(base+'/'+encodeURIComponent(id)+'/history'+suffix,{signal}));
   if(!Array.isArray(events.items))throw new Error('任务记录响应无效');
   if(current())setHistory(previous=>cursor?{...events,items:[...previous.items,...events.items.filter((item:AgentTaskEvent)=>!previous.items.some(event=>event.version===item.version&&event.action===item.action))]}:events);
  }catch(error){if(current())setHistoryError(error instanceof Error?error.message:'任务记录读取失败');}
  finally{if(current()){historyAbort.current=null;setHistoryLoading(false);}}
 };
 const openDetail=(id:string)=>{
  detailGeneration.current++;detailAbort.current?.abort();
  setDetailTarget(id);setCurrentDetail(null);setHistory({items:[],nextCursor:null});setOpening(true);setDetailError('');
  void readDetailHistory(id);
  return readDetail(id,true);
 };
 React.useEffect(()=>{if(refreshSignal)void currentLoad.current();},[refreshSignal]);
 const routeTaskId=nav?.route?.section==='tasks'?nav.route.id:undefined;
 const closeDetail=()=>{
  detailGeneration.current++;detailAbort.current?.abort();historyAbort.current?.abort();setDetailTarget(null);setCurrentDetail(null);setOpening(false);
  if(!routeTaskId)return;
  const automationId=nav.route.automationId;
  nav.go('assistant',automationId,{section:automationId?'automations':'tasks'});
 };
 React.useEffect(()=>{if(routeTaskId)void openDetail(routeTaskId);},[routeTaskId,base]);
 const begin=(next:Plan)=>{setFailure('');setUncertain(false);setCredential(null);setPlan(next);};
 const closePlan=()=>{if(busy)return;writeGeneration.current++;writeAbort.current?.abort();setPlan(null);setCredential(null);setFailure('');setUncertain(false);};
 const submit=async()=>{
  if(!plan||busy)return;const epoch=++writeGeneration.current,abort=new AbortController();writeAbort.current=abort;setBusy(true);setFailure('');
  const url=plan.kind==='create'?base:base+'/'+encodeURIComponent(plan.row.id)+'/'+plan.kind;
  const body=plan.kind==='create'?{requestId:plan.requestId,identityId:plan.identityId,name:plan.name,instructions:plan.instructions,...(plan.executor==='platform'?{executor:'platform',locale:interfaceLocale()}:{})}:plan.kind==='answer'?{requestId:plan.requestId,version:plan.row.version,questionId:plan.questionId,answer:plan.answer}:{requestId:plan.requestId,version:plan.row.version};
  try{const result=await mistApiRequest(url,{method:'POST',body:JSON.stringify(body),signal:abort.signal});if(!alive.current||epoch!==writeGeneration.current)return;
   if(plan.kind==='issue'){if(typeof result.token!=='string'||!result.item?.id)throw new Error('任务连接响应无效');setCredential(result);}else toast(uiText(plan.kind==='answer'?'资料已补充':plan.kind==='create'&&result.item.state==='queued'?'任务已安排':LABEL[result.item.state as AgentTaskView['state']]??'已核对当前任务状态'),'ok');
   setPlan(null);setUncertain(false);
   const openItem=detailRef.current;
   const sameTask=openItem&&openItem.id===result.item?.id;
   const mayPublish=!sameTask||!contentRestricted(openItem)||contentRestricted(result.item);
   if(sameTask){detailAbort.current?.abort();detailAbort.current=null;if(mayPublish)setCurrentDetail(result.item);}
   if(result.item&&plan.kind!=='issue'&&mayPublish)onTaskUpdate?.(result.item);
   void currentLoad.current();
   window.dispatchEvent(new Event('bambook:agent-task-update'));
   if(plan.kind==='cancel')void w.refresh();
  }catch(e){if(alive.current&&!abort.signal.aborted&&epoch===writeGeneration.current){setFailure(e instanceof Error?e.message:'操作未完成，请重试');setUncertain(!(e as any)?.status||(e as any).status>=500);}}
  finally{if(alive.current&&epoch===writeGeneration.current)setBusy(false);}
 };
 const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);if(alive.current)toast(uiText('已复制'),'ok');}catch{if(alive.current)setError('复制失败，请重试');}};
 const openOriginal=()=>{
  const source=detail?.waitingFor?.link;if(!source)return;
  const target=agentSource(source);if(target)nav.go(target.view,target.id,target.target);
 };
 const active=identities.filter(i=>i.state==='active'),aiUnavailable=identities.some(i=>i.state==='invalid'&&i.canIssue===false),create=plan?.kind==='create'?plan:null,answer=plan?.kind==='answer'?plan:null;
 const detailProgressUnavailable=detailNeedsRead||!!detailError;
 const detailModelSince=detail&&!detailProgressUnavailable&&!detail.runnerStatus
  &&detail.state==='running'&&detail.executionStage==='model'
  ? activeModelFallbackSince(detail)??detail.executionStageSince : undefined;
 const columns:Column<AgentTaskView>[]=[{key:'name',header:uiText('任务'),render:r=><div className="mist-col"><span className="mist-cell-strong">{r.name}</span><span className="mist-cell-sub">{r.identityName}</span></div>},{key:'state',header:uiText('状态'),width:'118px',render:r=><Pill tone={tone(r.state)}>{uiText(statusLabel(r))}</Pill>},{key:'usage',header:uiText('业务操作'),width:'90px',render:r=><span>{r.stepsUsed} / {r.stepLimit}</span>,hideOnMobile:true},...(rowAction?[{key:'act',header:'',width:'90px',render:rowAction}]:[])];
 const control=(row:AgentTaskView)=><div className="mist-row" data-wrap>
  {row.executor!=='platform'&&!['succeeded','failed','cancelled','expired','budget_exhausted','access_changed'].includes(row.state)&&<Button disabled={!endpoint||busy} onClick={()=>begin({kind:'issue',requestId:crypto.randomUUID(),row})}>{uiText('连接Agent')}</Button>}
  {row.state==='paused'&&<Button disabled={busy} onClick={()=>begin({kind:'resume',requestId:crypto.randomUUID(),row})}>{uiText('继续任务')}</Button>}
  {['queued','running','waiting_time','waiting_condition','waiting_human'].includes(row.state)&&<Button disabled={busy} onClick={()=>begin({kind:'pause',requestId:crypto.randomUUID(),row})}>{uiText('暂停任务')}</Button>}
  {row.canControl&&<Button variant="quiet" disabled={busy} onClick={()=>begin({kind:'cancel',requestId:crypto.randomUUID(),row})}>{uiText('停止任务')}</Button>}
 </div>;
 return <div className="mist-col">
  <div className="mist-row"><span className="mist-spacer"/><Button icon={RefreshCw} disabled={loading||busy} onClick={()=>void currentLoad.current()}>{uiText('刷新')}</Button>{(!rowAction||active.some(i=>i.kind!=='personal'))&&<Button variant={rowAction?'secondary':'primary'} icon={Plus} disabled={busy||loading||!active.length} title={uiText(aiUnavailable?'当前无AI使用权限':!active.length?'请先启用Agent连接':undefined)} onClick={()=>begin({kind:'create',requestId:crypto.randomUUID(),identityId:'',name:'',instructions:'',executor:'external'})}>{uiText('新建任务')}</Button>}</div>
  {error&&<FailureNotice title="任务读取失败" detail={error} />}
  {!error&&connectionError&&<FailureNotice title="Agent连接读取失败" detail={connectionError} />}
  {(!error||page.items.length>0)&&<DataTable ariaLabel={uiText('Agent任务')} loading={loading} columns={columns} rows={page.items} rowKey={r=>r.id} onRowClick={r=>void openDetail(r.id)} empty={<EmptyState icon={Bot} title={uiText(active.length||rowAction?'暂无任务':'暂无可用的Agent连接')} action={!active.length&&!rowAction?<Button onClick={onConnections}>{uiText('管理连接')}</Button>:undefined}/>} />}
  {page.nextCursor&&<Button loading={loadingMore} onClick={()=>void load(true,false)}>{uiText('加载更多')}</Button>}
  <Drawer open={!!detailTarget} onClose={closeDetail} title={detail?.name??uiText('任务')} footer={detail&&detail.canControl?control(detail):undefined}>
   {opening&&!detail&&<Skeleton/>}
   {detailError&&detailTarget&&<FailureNotice title="任务详情读取失败" detail={detailError} retry={()=>void openDetail(detailTarget)}/>}
   {detail&&<div className="mist-col"><div className="mist-row"><Pill tone={tone(detail.state)}>{uiText(statusLabel(detail,detailProgressUnavailable))}</Pill>{detailModelSince&&<XiaozhuPhaseTimer at={detailModelSince}/>}
    {contentRestricted(detail)&&detail.state!=='access_changed'&&<Pill tone="warn">{uiText('权限已变化')}</Pill>}
   </div>
    <KeyValue items={[
      {label:uiText('执行方式'),value:uiText(detail.executor==='platform'?'平台执行':'外部客户端')},
      {label:uiText('Agent连接'),value:detail.identityName},
      ...(detail.canControl&&detail.state!=='access_changed'?[{label:uiText('办理权限'),value:uiText(detail.mode==='read'?'只读':'可办理')}]:[]),
      {label:uiText('负责人'),value:detail.ownerName},
      {label:uiText('有效期至'),value:time(detail.expiresAt)},
      {label:uiText('最近心跳'),value:time(detail.lastHeartbeatAt)},
      {label:uiText('业务操作'),value:`${detail.stepsUsed} / ${detail.stepLimit}`},
      {label:uiText('累计执行 / 上限'),value:`${duration(detail.runtimeUsedMs)} / ${duration(detail.runtimeLimitMs)}`},
    ]} />
    {(detail.waitingFor||detail.resumeAt||detail.wakeReason)&&<KeyValue items={[...(detail.waitingFor?[{label:uiText('等待资料'),value:detail.waitingFor.label}]:[]),...(detail.resumeAt?[{label:uiText(detail.waitingFor?'等待截止':'计划继续'),value:time(detail.resumeAt)}]:[]),...(detail.wakeReason?[{label:uiText('继续原因'),value:uiText(detail.wakeReason==='changed'?'资料已变化':'到达最晚时间')}]:[])]}/>}
    {detail.waitingFor?.link&&<Button onClick={openOriginal}>{uiText('查看原资料')}</Button>}
    {detail.instructions&&<div className="mist-col"><span className="mist-label">{uiText('任务内容')}</span><p className="mist-sub">{detail.instructions}</p></div>}
    {detail.executionIssue&&<Banner tone="bad" title={uiText(detail.executionIssue.code==='model_response_invalid'?'模型响应无效':'模型暂不可用')}>{detail.executionIssue.retryAt?uiText('下次重试')+' '+time(detail.executionIssue.retryAt):undefined}</Banner>}{detail.checkpoint&&<Banner tone="ai" title={uiText('最近检查点')}>{detail.checkpoint}</Banner>}{detail.result&&<Card><CardHeader title={uiText('Agent执行报告')}/><CardBody><XiaozhuMarkdown text={detail.result} index={[]} onOpen={(view,id,target)=>nav.go(view,id,target)}/></CardBody></Card>}
    {(detail.questions??[]).map(q=><div className="mist-col" key={q.id}><span className="mist-label">{uiText(q.answeredAt?'Agent提问':'待补充资料')}</span><p className="mist-sub">{q.question}</p>{q.answer&&<><span className="mist-label">{uiText('本人答复')}</span><p className="mist-sub">{q.answer}</p></>}{!q.answeredAt&&detail.canControl&&['waiting_human','paused'].includes(detail.state)&&<Button onClick={()=>begin({kind:'answer',row:detail,questionId:q.id,answer:'',requestId:crypto.randomUUID()})}>{uiText('补充资料')}</Button>}</div>)}
    {detail.state==='waiting_human'&&detail.waitingProposalIds.length>0&&<Button onClick={()=>nav.go('cockpit')}>{uiText('查看待确认事项')}</Button>}
    <Button variant="quiet" icon={Copy} onClick={()=>void copy(detail.id)}>{uiText('复制任务编号')}</Button>
    {history.items.map((event,i)=><div className="mist-row" key={i}><span>{uiText(ACTION[event.action]??event.action)}</span><span className="mist-spacer"/><span className="mist-sub">{event.actorName} · {time(event.at)}</span></div>)}{historyError&&<FailureNotice title="任务记录读取失败" detail={historyError} retry={()=>void readDetailHistory(detail.id,history.nextCursor)}/>}
    {history.nextCursor&&<Button disabled={historyLoading} onClick={()=>void readDetailHistory(detail.id,history.nextCursor)}>{uiText('更多记录')}</Button>}
   </div>}
  </Drawer>
  <Dialog open={!!plan} onClose={closePlan} title={uiText(create?'新建任务':answer?'补充资料':plan?.kind==='issue'?'连接Agent':plan?.kind==='pause'?'暂停任务':plan?.kind==='resume'?'继续任务':'停止任务')} footer={<><Button disabled={busy} onClick={closePlan}>{uiText(uncertain?'关闭':'取消')}</Button><Button variant={plan?.kind==='cancel'?'danger':'primary'} loading={busy} disabled={busy||!!create&&(!create.identityId||!create.name.trim()||!create.instructions.trim()||create.executor==='platform'&&!platformAvailable)||!!answer&&!answer.answer.trim()} onClick={()=>void submit()}>{uiText(uncertain?'核对原操作':create?'安排任务':answer?'提交答复':plan?.kind==='issue'?'生成任务连接':'确认')}</Button></>}>
   <div className="mist-col">{failure&&<Banner tone="bad" title={failure}/>}
    {create?.executor==='platform'&&!platformAvailable&&<Banner tone="bad" title={uiText('平台执行暂不可用')}/>}{create?<FormGrid><Field label={uiText('执行方式')} required full><Select value={create.executor} disabled={uncertain||busy} options={[{value:'external',label:uiText('外部客户端')},{value:'platform',label:uiText('平台执行')}]} onChange={e=>setPlan({...create,executor:e.target.value as 'external'|'platform'})}/></Field><Field label={uiText('Agent连接')} required full><Select value={create.identityId} disabled={uncertain} onChange={e=>setPlan({...create,identityId:e.target.value})} placeholder={uiText('请选择连接')} options={active.map(i=>({value:i.id,label:`${i.name} · ${uiText(i.mode==='read'?'只读':'可办理')}`}))}/></Field><Field label={uiText('任务名称')} required full><TextInput value={create.name} disabled={uncertain} onChange={e=>setPlan({...create,name:e.target.value})} maxLength={60}/></Field><Field label={uiText('任务内容')} required full><TextArea value={create.instructions} disabled={uncertain} onChange={e=>setPlan({...create,instructions:e.target.value})} maxLength={4000} rows={5}/></Field></FormGrid>:answer?<><KeyValue items={[{label:uiText('任务'),value:answer.row.name}]} /><p className="mist-sub">{answer.row.questions?.find(q=>q.id===answer.questionId)?.question}</p><Field label={uiText('答复')} required><TextArea value={answer.answer} disabled={uncertain} onChange={e=>setPlan({...answer,answer:e.target.value})} maxLength={4000} rows={5}/></Field></>:plan&&'row'in plan?<><KeyValue items={[{label:uiText('任务'),value:plan.row.name},{label:uiText('当前状态'),value:uiText(statusLabel(plan.row))}]} />{plan.kind==='cancel'&&<p className="mist-sub">{uiText('停止后不再续办，已办理的业务保留。')}</p>}{plan.kind==='issue'&&plan.row.state==='running'&&<p className="mist-sub">{uiText('重新连接将中断当前执行器。')}</p>}</>:null}
   </div>
  </Dialog>
  <Dialog open={!!credential} onClose={()=>setCredential(null)} title={uiText('任务连接')} footer={<><Button onClick={()=>setCredential(null)}>{uiText('关闭')}</Button><Button icon={Copy} disabled={!credential||!endpoint} onClick={()=>credential&&endpoint&&void copy(JSON.stringify({mcpServers:{'bambook-task':{url:endpoint,headers:{'x-bambook-task-control':credential.token}}}},null,2))}>{uiText('复制配置')}</Button></>}>
   {credential&&<FormGrid><Field label={uiText('连接地址')} full><TextInput value={endpoint??''} readOnly/></Field><Field label={uiText('连接凭据')} full><TextInput type="password" value={credential.token} readOnly/></Field><KeyValue items={[{label:uiText('任务'),value:credential.item.name},{label:uiText('有效期至'),value:time(credential.item.expiresAt)}]}/></FormGrid>}
  </Dialog>
 </div>;
}
