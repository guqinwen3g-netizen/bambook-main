import React from 'react';
import { Bot, Copy, Plus, RefreshCw } from 'lucide-react';
import { Banner, Button, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, Pill, Segmented, Select, Skeleton, TextArea, TextInput, useToast, type Column, type Tone } from '../../../../components/mist';
import type { AgentTaskEvent, AgentTaskPage, AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import type { AgentIdentityView } from '../../../../server/src/shared/mistAgentIdentities';
import { uiText, interfaceLocale } from '../../../../services/interfaceLanguage';
import { mistApiRequest, useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { useNav } from '../nav';
import { AgentIdentities } from './AgentIdentities';
import { agentConnectionEndpoint } from './AgentConnections';

const LABEL:Record<AgentTaskView['state'],string>={queued:'待领取',running:'执行中',waiting_time:'等待继续',waiting_condition:'等待资料变化',waiting_human:'待本人确认',paused:'已暂停',succeeded:'执行结束',failed:'执行失败',cancelled:'已停止',expired:'已到期',budget_exhausted:'达到限额',access_changed:'权限已变化'};
const ACTION:Record<string,string>={created:'安排任务',connected:'签发任务连接',claimed:'执行器领取',checkpoint:'保存检查点',waiting_human:'等待本人确认',question:'请求补充资料',waiting_time:'等待约定时间',waiting_condition:'等待资料变化',condition_changed:'资料已变化',condition_deadline:'到达最晚时间',answered:'本人补充资料',model_retry:'模型重试',model_paused:'模型已暂停',recovering:'等待接续',confirmed:'本人确认',rejected:'本人拒绝',pause:'暂停任务',resume:'继续任务',cancel:'停止任务',finished:'执行结束'};
const statusLabel=(row:AgentTaskView)=>row.state==='waiting_human'&&row.questions?.some(q=>!q.answeredAt)?'待补充资料':row.state==='queued'&&row.executionIssue?'等待重试':row.state==='queued'&&row.executor==='platform'?'待执行':row.state==='queued'&&row.lastHeartbeatAt?'待重新领取':LABEL[row.state];
const tone=(state:AgentTaskView['state']):Tone=>state==='running'?'accent':state==='succeeded'?'ok':['waiting_human','expired','budget_exhausted'].includes(state)?'warn':['failed','access_changed'].includes(state)?'bad':'neutral';
const time=(v:string|null)=>v?new Date(v).toLocaleString(interfaceLocale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const duration=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
type Plan={kind:'create';requestId:string;identityId:string;name:string;instructions:string;executor:'external'|'platform'}|{kind:'answer';requestId:string;row:AgentTaskView;questionId:string;answer:string}|{kind:'pause'|'resume'|'cancel'|'issue';requestId:string;row:AgentTaskView};
export function LongAgentWorkspace(){
 const [view,setView]=React.useState('tasks');
 return <div className="mist-col"><Segmented aria-label={uiText('长期Agent视图')} value={view} onChange={setView} options={[{value:'tasks',label:uiText('任务')},{value:'connections',label:uiText('连接')}]} />
  {view==='connections'?<AgentIdentities/>:<AgentTasks onConnections={()=>setView('connections')}/>}</div>;
}
export function AgentTasks({onConnections}:{onConnections:()=>void}){
 const w=useMistWorkspace(),s=useMistSession();
 return w.workspace?<TaskPanel key={JSON.stringify([s.sessionKey,s.user?.id,w.workspace.id])} workspaceId={w.workspace.id} onConnections={onConnections}/>:<EmptyState title={uiText('尚未进入公司')}/>;
}
function TaskPanel({workspaceId,onConnections}:{workspaceId:string;onConnections:()=>void}){
 const w=useMistWorkspace(),nav=useNav(),toast=useToast(),base='/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-tasks',endpoint=agentConnectionEndpoint(location.origin);
 const [platformAvailable,setPlatformAvailable]=React.useState(false);
 const [page,setPage]=React.useState<AgentTaskPage>({items:[],nextCursor:null}),[identities,setIdentities]=React.useState<AgentIdentityView[]>([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
 const [plan,setPlan]=React.useState<Plan|null>(null),[busy,setBusy]=React.useState(false),[failure,setFailure]=React.useState(''),[uncertain,setUncertain]=React.useState(false),[credential,setCredential]=React.useState<{item:AgentTaskView;token:string}|null>(null);
 const [detail,setDetail]=React.useState<AgentTaskView|null>(null),[history,setHistory]=React.useState<{items:AgentTaskEvent[];nextCursor:string|null}>({items:[],nextCursor:null}),[detailError,setDetailError]=React.useState('');
 const [opening,setOpening]=React.useState(false);
 const detailRef=React.useRef(detail);detailRef.current=detail;
 const alive=React.useRef(false),readGeneration=React.useRef(0),writeGeneration=React.useRef(0),detailGeneration=React.useRef(0),readAbort=React.useRef<AbortController|null>(null),writeAbort=React.useRef<AbortController|null>(null);
 const load=React.useCallback(async(append=false)=>{
  const epoch=++readGeneration.current,abort=new AbortController();readAbort.current?.abort();readAbort.current=abort;setError('');
  const selected=detailRef.current?.id,selectedGeneration=detailGeneration.current;
  const readConnections=async()=>{const items:AgentIdentityView[]=[],seen=new Set<string>();let cursor:string|null=null;do{const result=await mistApiRequest('/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-identities?scope=mine'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal:abort.signal});if(!Array.isArray(result.items))throw new Error('任务响应无效');items.push(...result.items);cursor=result.nextCursor??null;if(cursor&&seen.has(cursor))throw new Error('任务响应无效');if(cursor)seen.add(cursor);}while(cursor);return{items};};
  try{const [result,connections,selectedResult,events,capabilities]=await Promise.all([mistApiRequest(base+(append&&page.nextCursor?'?cursor='+encodeURIComponent(page.nextCursor):''),{signal:abort.signal}),readConnections(),selected?mistApiRequest(base+'/'+encodeURIComponent(selected),{signal:abort.signal}):null,selected?mistApiRequest(base+'/'+encodeURIComponent(selected)+'/history',{signal:abort.signal}):null,mistApiRequest('/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-task-capabilities',{signal:abort.signal}).catch(()=>({platformAvailable:false}))]);
   if(!alive.current||epoch!==readGeneration.current)return;if(!Array.isArray(result.items)||!Array.isArray(connections.items))throw new Error('任务响应无效');
   setPage(previous=>append?{...result,items:[...previous.items,...result.items.filter((r:AgentTaskView)=>!previous.items.some(p=>p.id===r.id))]}:result);setIdentities(connections.items);setPlatformAvailable(capabilities.platformAvailable===true);
   if(selected&&selectedGeneration===detailGeneration.current&&detailRef.current?.id===selected&&selectedResult?.item&&events){setDetail(selectedResult.item);setHistory(previous=>{const fresh=events.items as AgentTaskEvent[];return{items:[...fresh,...previous.items.filter(old=>!fresh.some(event=>event.version===old.version&&event.action===old.action))],nextCursor:previous.items.length>30?previous.nextCursor:events.nextCursor};});setDetailError('');}
  }catch(e){if(alive.current&&!abort.signal.aborted&&epoch===readGeneration.current){setError(e instanceof Error?e.message:'任务读取失败');if([401,403,404].includes((e as any)?.status)){setPage({items:[],nextCursor:null});setDetail(null);setPlan(null);setCredential(null);}}}
  finally{if(alive.current&&epoch===readGeneration.current)setLoading(false);}
 },[base,workspaceId,page.nextCursor]);
 const currentLoad=React.useRef(load);currentLoad.current=load;
 React.useEffect(()=>{alive.current=true;void currentLoad.current();const timer=setInterval(()=>void currentLoad.current(),10_000);return()=>{alive.current=false;readGeneration.current++;writeGeneration.current++;detailGeneration.current++;clearInterval(timer);readAbort.current?.abort();writeAbort.current?.abort();};},[base]);
 const openDetail=async(row:Pick<AgentTaskView,'id'>,appendHistory=false)=>{const epoch=++detailGeneration.current;if(detailRef.current?.id!==row.id)setHistory({items:[],nextCursor:null});if('name'in row)setDetail(row as AgentTaskView);else setDetail(null);setOpening(true);setDetailError('');try{const [result,events]=await Promise.all([mistApiRequest(base+'/'+encodeURIComponent(row.id)),mistApiRequest(base+'/'+encodeURIComponent(row.id)+'/history'+(appendHistory&&history.nextCursor?'?cursor='+encodeURIComponent(history.nextCursor):''))]);if(!alive.current||epoch!==detailGeneration.current)return;setDetail(result.item);setHistory(previous=>appendHistory?{...events,items:[...previous.items,...events.items]}:events);}catch(e){if(alive.current&&epoch===detailGeneration.current){setDetailError(e instanceof Error?e.message:'任务读取失败');setDetail(null);}}finally{if(alive.current&&epoch===detailGeneration.current)setOpening(false);}};
 const routeTaskId=nav?.route?.section==='agents'?nav.route.id:undefined;
 React.useEffect(()=>{if(routeTaskId)void openDetail({id:routeTaskId});},[routeTaskId,base]);
 const begin=(next:Plan)=>{setFailure('');setUncertain(false);setCredential(null);setPlan(next);};
 const closePlan=()=>{if(busy)return;writeGeneration.current++;writeAbort.current?.abort();setPlan(null);setCredential(null);setFailure('');setUncertain(false);};
 const submit=async()=>{
  if(!plan||busy)return;const epoch=++writeGeneration.current,abort=new AbortController();writeAbort.current=abort;setBusy(true);setFailure('');
  const url=plan.kind==='create'?base:base+'/'+encodeURIComponent(plan.row.id)+'/'+plan.kind;
  const body=plan.kind==='create'?{requestId:plan.requestId,identityId:plan.identityId,name:plan.name,instructions:plan.instructions,...(plan.executor==='platform'?{executor:'platform',locale:interfaceLocale()}:{})}:plan.kind==='answer'?{requestId:plan.requestId,version:plan.row.version,questionId:plan.questionId,answer:plan.answer}:{requestId:plan.requestId,version:plan.row.version};
  try{const result=await mistApiRequest(url,{method:'POST',body:JSON.stringify(body),signal:abort.signal});if(!alive.current||epoch!==writeGeneration.current)return;
   if(plan.kind==='issue'){if(typeof result.token!=='string'||!result.item?.id)throw new Error('任务连接响应无效');setCredential(result);}else toast(uiText(plan.kind==='answer'?'资料已补充':plan.kind==='create'&&result.item.state==='queued'?'任务已安排':LABEL[result.item.state as AgentTaskView['state']]??'已核对当前任务状态'),'ok');
   setPlan(null);setUncertain(false);if(detail?.id===result.item?.id)setDetail(result.item);void currentLoad.current();window.dispatchEvent(new Event('bambook:agent-task-update'));if(plan.kind==='cancel')void w.refresh();
  }catch(e){if(alive.current&&!abort.signal.aborted&&epoch===writeGeneration.current){setFailure(e instanceof Error?e.message:'操作未完成，请重试');setUncertain(!(e as any)?.status||(e as any).status>=500);}}
  finally{if(alive.current&&epoch===writeGeneration.current)setBusy(false);}
 };
 const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);if(alive.current)toast(uiText('已复制'),'ok');}catch{if(alive.current)setError('复制失败，请重试');}};
 const openOriginal=()=>{
  const source=detail?.waitingFor?.link;if(!source)return;
  try{const link=new URL(source);if(link.protocol!=='bambook:'||link.hostname!=='open')return;const view=link.searchParams.get('view'),id=link.searchParams.get('id'),section=link.searchParams.get('section');if(view&&id)nav.go(view,id,section?{section}:undefined);}catch{/* Invalid links cannot launch an external destination. */}
 };
 const active=identities.filter(i=>i.state==='active'),aiUnavailable=identities.some(i=>i.state==='invalid'&&i.canIssue===false),create=plan?.kind==='create'?plan:null,answer=plan?.kind==='answer'?plan:null;
 const columns:Column<AgentTaskView>[]=[{key:'name',header:uiText('任务'),render:r=><div className="mist-col"><span className="mist-cell-strong">{r.name}</span><span className="mist-cell-sub">{r.identityName}</span></div>},{key:'state',header:uiText('状态'),width:'118px',render:r=><Pill tone={tone(r.state)}>{uiText(statusLabel(r))}</Pill>},{key:'usage',header:uiText('业务操作'),width:'90px',render:r=><span>{r.stepsUsed} / {r.stepLimit}</span>,hideOnMobile:true}];
 const control=(row:AgentTaskView)=><div className="mist-row" data-wrap>
  {row.executor!=='platform'&&!['succeeded','failed','cancelled','expired','budget_exhausted','access_changed'].includes(row.state)&&<Button disabled={!endpoint||busy} onClick={()=>begin({kind:'issue',requestId:crypto.randomUUID(),row})}>{uiText('连接Agent')}</Button>}
  {row.state==='paused'&&<Button disabled={busy} onClick={()=>begin({kind:'resume',requestId:crypto.randomUUID(),row})}>{uiText('继续任务')}</Button>}
  {['queued','running','waiting_time','waiting_condition','waiting_human'].includes(row.state)&&<Button disabled={busy} onClick={()=>begin({kind:'pause',requestId:crypto.randomUUID(),row})}>{uiText('暂停任务')}</Button>}
  {row.canControl&&<Button variant="quiet" disabled={busy} onClick={()=>begin({kind:'cancel',requestId:crypto.randomUUID(),row})}>{uiText('停止任务')}</Button>}
 </div>;
 return <div className="mist-col">
  <div className="mist-row"><span className="mist-spacer"/><Button icon={RefreshCw} disabled={loading||busy} onClick={()=>void currentLoad.current()}>{uiText('刷新')}</Button><Button variant="primary" icon={Plus} disabled={busy||loading||!active.length} title={uiText(aiUnavailable?'当前无AI使用权限':!active.length?'请先启用Agent连接':undefined)} onClick={()=>begin({kind:'create',requestId:crypto.randomUUID(),identityId:'',name:'',instructions:'',executor:'external'})}>{uiText('新建任务')}</Button></div>
  {error&&<Banner tone="bad" title={error}/>}<DataTable ariaLabel={uiText('Agent任务')} loading={loading} columns={columns} rows={page.items} rowKey={r=>r.id} onRowClick={r=>void openDetail(r)} empty={<EmptyState icon={Bot} title={uiText(active.length?'暂无任务':'暂无可用的Agent连接')} action={!active.length?<Button onClick={onConnections}>{uiText('管理连接')}</Button>:undefined}/>} />
  {page.nextCursor&&<Button onClick={()=>void load(true)}>{uiText('加载更多')}</Button>}
  {detailError&&<Banner tone="bad" title={detailError}/>}
  <Drawer open={!!detail||opening} onClose={()=>{detailGeneration.current++;setDetail(null);setOpening(false);if(routeTaskId)nav.go('account',undefined,{section:'agents'});}} title={detail?.name??uiText('任务')} footer={detail&&detail.canControl?control(detail):undefined}>
   {opening&&!detail&&<Skeleton/>}
   {detail&&<div className="mist-col"><div className="mist-row"><Pill tone={tone(detail.state)}>{uiText(statusLabel(detail))}</Pill></div>
    <KeyValue items={[{label:uiText('执行方式'),value:uiText(detail.executor==='platform'?'平台执行':'外部客户端')},{label:uiText('Agent连接'),value:detail.identityName},{label:uiText('办理权限'),value:uiText(detail.mode==='read'?'只读':'可办理')},{label:uiText('负责人'),value:detail.ownerName},{label:uiText('有效期至'),value:time(detail.expiresAt)},{label:uiText('最近心跳'),value:time(detail.lastHeartbeatAt)},{label:uiText('业务操作'),value:`${detail.stepsUsed} / ${detail.stepLimit}`},{label:uiText('累计执行 / 上限'),value:`${duration(detail.runtimeUsedMs)} / ${duration(detail.runtimeLimitMs)}`}]} />
    {detail.waitingFor&&<KeyValue items={[{label:uiText('等待资料'),value:detail.waitingFor.label}]}/>}
    {detail.resumeAt&&<KeyValue items={[{label:uiText(detail.waitingFor?'最晚继续':'计划继续'),value:time(detail.resumeAt)}]}/>}
    {detail.waitingFor?.link&&<Button onClick={openOriginal}>{uiText('查看原资料')}</Button>}
    {detail.wakeReason&&<KeyValue items={[{label:uiText('继续原因'),value:uiText(detail.wakeReason==='changed'?'资料已变化':'到达最晚时间')}]}/>}
    {detail.instructions&&<div className="mist-col"><span className="mist-label">{uiText('任务内容')}</span><p className="mist-sub">{detail.instructions}</p></div>}
    {detail.executionIssue&&<Banner tone="bad" title={uiText(detail.executionIssue.code==='model_response_invalid'?'模型响应无效':'模型暂不可用')}>{detail.executionIssue.retryAt?uiText('下次重试')+' '+time(detail.executionIssue.retryAt):undefined}</Banner>}{detail.checkpoint&&<Banner tone="ai" title={uiText('最近检查点')}>{detail.checkpoint}</Banner>}{detail.result&&<Banner tone="ai" title={uiText('Agent执行报告')}>{detail.result}</Banner>}
    {(detail.questions??[]).map(q=><div className="mist-col" key={q.id}><span className="mist-label">{uiText(q.answeredAt?'Agent提问':'待补充资料')}</span><p className="mist-sub">{q.question}</p>{q.answer&&<><span className="mist-label">{uiText('本人答复')}</span><p className="mist-sub">{q.answer}</p></>}{!q.answeredAt&&detail.canControl&&['waiting_human','paused'].includes(detail.state)&&<Button onClick={()=>begin({kind:'answer',row:detail,questionId:q.id,answer:'',requestId:crypto.randomUUID()})}>{uiText('补充资料')}</Button>}</div>)}
    {detail.state==='waiting_human'&&detail.waitingProposalIds.length>0&&<Button onClick={()=>nav.go('cockpit')}>{uiText('查看待确认事项')}</Button>}
    <Button variant="quiet" icon={Copy} onClick={()=>void copy(detail.id)}>{uiText('复制任务编号')}</Button>
    {history.items.map((event,i)=><div className="mist-row" key={i}><span>{uiText(ACTION[event.action]??event.action)}</span><span className="mist-spacer"/><span className="mist-sub">{event.actorName} · {time(event.at)}</span></div>)}{history.nextCursor&&<Button onClick={()=>void openDetail(detail,true)}>{uiText('更多记录')}</Button>}
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
